"use strict";

const Transaction = require("../db/models/Transaction");
const { typesAreCompatible } = require("../utils/typeNormalizer");
const logger = require("../utils/logger");

/**
 * Matching Engine
 * ───────────────
 * Algorithm (two-phase):
 *
 * Phase 1 – Candidate generation (O(n) per user tx using a time-window index)
 *   For each valid user transaction, fetch exchange transactions whose
 *   normalised timestamp falls within ± timestampToleranceSeconds AND whose
 *   asset matches.  This keeps the candidate set tiny.
 *
 * Phase 2 – Scoring & best-match selection
 *   Score each candidate on quantity closeness and timestamp closeness.
 *   The highest-scoring candidate that also satisfies type compatibility is
 *   the match.  If the best candidate exceeds tolerances it becomes
 *   "conflicting" rather than "matched".
 *
 * Ties: if two exchange candidates share the same best score we keep both
 * as conflicting rather than guessing — better to surface for human review.
 *
 * One-to-one enforcement: a matched exchange transaction is removed from the
 * candidate pool so it cannot be re-matched.
 */

/**
 * @typedef {object} MatchConfig
 * @property {number} timestampToleranceSeconds
 * @property {number} quantityTolerancePct
 */

/**
 * @typedef {object} MatchResult
 * @property {object} userTx
 * @property {object|null} exchangeTx
 * @property {"matched"|"conflicting"|"unmatched_user"} category
 * @property {string} reason
 * @property {Array} conflicts
 * @property {number|null} matchScore
 */

/**
 * Compute a 0–1 similarity score between a user and exchange transaction.
 * Higher is better.
 */
function computeScore(userTx, exTx, config) {
  const timeDeltaMs = Math.abs(
    userTx.normalisedTimestamp - exTx.normalisedTimestamp
  );
  const timeDeltaS = timeDeltaMs / 1000;
  const timeScore =
    timeDeltaS <= config.timestampToleranceSeconds
      ? 1 - timeDeltaS / config.timestampToleranceSeconds
      : 0;

  const qtyDeltaPct =
    userTx.normalisedQuantity > 0
      ? Math.abs(userTx.normalisedQuantity - exTx.normalisedQuantity) /
        userTx.normalisedQuantity
      : userTx.normalisedQuantity === exTx.normalisedQuantity
      ? 0
      : Infinity;
  const qtyScore =
    qtyDeltaPct <= config.quantityTolerancePct
      ? 1 - qtyDeltaPct / config.quantityTolerancePct
      : 0;

  return (timeScore + qtyScore) / 2;
}

/**
 * Describe what conflicts exist between a user and exchange transaction.
 */
function describeConflicts(userTx, exTx, config) {
  const conflicts = [];

  const timeDeltaS =
    Math.abs(userTx.normalisedTimestamp - exTx.normalisedTimestamp) / 1000;
  if (timeDeltaS > config.timestampToleranceSeconds) {
    conflicts.push({
      field: "timestamp",
      userValue: userTx.raw.timestamp,
      exchangeValue: exTx.raw.timestamp,
      delta: `${timeDeltaS.toFixed(1)}s`,
      tolerance: `${config.timestampToleranceSeconds}s`,
    });
  }

  if (userTx.normalisedQuantity != null && exTx.normalisedQuantity != null) {
    const qtyDeltaPct =
      userTx.normalisedQuantity > 0
        ? Math.abs(userTx.normalisedQuantity - exTx.normalisedQuantity) /
          userTx.normalisedQuantity
        : userTx.normalisedQuantity === exTx.normalisedQuantity
        ? 0
        : Infinity;
    if (qtyDeltaPct > config.quantityTolerancePct) {
      conflicts.push({
        field: "quantity",
        userValue: userTx.normalisedQuantity,
        exchangeValue: exTx.normalisedQuantity,
        delta: `${(qtyDeltaPct * 100).toFixed(4)}%`,
        tolerance: `${(config.quantityTolerancePct * 100).toFixed(4)}%`,
      });
    }
  }

  return conflicts;
}

/**
 * Run the matching algorithm for a given runId.
 *
 * @param {string} runId
 * @param {MatchConfig} config
 * @returns {Promise<MatchResult[]>}
 */
async function matchTransactions(runId, config) {
  logger.info("Starting matching phase", { runId, config });

  // Load all valid transactions for this run
  const [userTxs, exchangeTxs] = await Promise.all([
    Transaction.find({ runId, source: "user", isValid: true }).lean(),
    Transaction.find({ runId, source: "exchange", isValid: true }).lean(),
  ]);

  logger.info("Loaded transactions for matching", {
    runId,
    userCount: userTxs.length,
    exchangeCount: exchangeTxs.length,
  });

  // Build a mutable set of unmatched exchange IDs
  const unmatchedExchangeIds = new Set(
    exchangeTxs.map((tx) => tx._id.toString())
  );

  // Index exchange txs by asset for fast candidate lookup
  const exchangeByAsset = new Map();
  for (const tx of exchangeTxs) {
    const key = tx.normalisedAsset ?? "__unknown__";
    if (!exchangeByAsset.has(key)) exchangeByAsset.set(key, []);
    exchangeByAsset.get(key).push(tx);
  }

  const results = [];

  for (const userTx of userTxs) {
    const toleranceMs = config.timestampToleranceSeconds * 1000;
    const userTs = userTx.normalisedTimestamp?.getTime?.() ?? null;
    const asset = userTx.normalisedAsset;

    // Get exchange candidates with matching asset (case already normalised)
    const candidates = (exchangeByAsset.get(asset) ?? []).filter((exTx) => {
      if (!unmatchedExchangeIds.has(exTx._id.toString())) return false;
      if (!exTx.normalisedTimestamp) return false;
      const exTs = exTx.normalisedTimestamp.getTime?.() ?? null;
      if (userTs == null || exTs == null) return false;
      return Math.abs(userTs - exTs) <= toleranceMs;
    });

    if (candidates.length === 0) {
      results.push({
        userTx,
        exchangeTx: null,
        category: "unmatched_user",
        reason: `No exchange transaction found for ${asset} within ±${config.timestampToleranceSeconds}s`,
        conflicts: [],
        matchScore: null,
      });
      continue;
    }

    // Filter to type-compatible candidates
    const compatible = candidates.filter((c) =>
      typesAreCompatible(userTx.normalisedType, c.normalisedType)
    );

    if (compatible.length === 0) {
      results.push({
        userTx,
        exchangeTx: null,
        category: "unmatched_user",
        reason: `Candidate(s) found for ${asset} by time but none with compatible type (user: ${userTx.normalisedType})`,
        conflicts: [],
        matchScore: null,
      });
      continue;
    }

    // Score all compatible candidates
    const scored = compatible.map((exTx) => ({
      exTx,
      score: computeScore(userTx, exTx, config),
    }));
    scored.sort((a, b) => b.score - a.score);

    const best = scored[0];
    const conflicts = describeConflicts(userTx, best.exTx, config);

    if (conflicts.length === 0) {
      // Clean match
      unmatchedExchangeIds.delete(best.exTx._id.toString());
      results.push({
        userTx,
        exchangeTx: best.exTx,
        category: "matched",
        reason: `Matched on asset, type-compatible, timestamp within tolerance, quantity within tolerance`,
        conflicts: [],
        matchScore: best.score,
      });
    } else {
      // The best candidate breaches at least one tolerance — conflicting
      // We still claim it so it can't be double-matched
      unmatchedExchangeIds.delete(best.exTx._id.toString());
      const conflictDesc = conflicts
        .map((c) => `${c.field} differs by ${c.delta} (tolerance: ${c.tolerance})`)
        .join("; ");
      results.push({
        userTx,
        exchangeTx: best.exTx,
        category: "conflicting",
        reason: `Candidate found but outside tolerance: ${conflictDesc}`,
        conflicts,
        matchScore: best.score,
      });
    }
  }

  // Any exchange tx still in the unmatched set is exchange-only
  for (const exTx of exchangeTxs) {
    if (unmatchedExchangeIds.has(exTx._id.toString())) {
      results.push({
        userTx: null,
        exchangeTx: exTx,
        category: "unmatched_exchange",
        reason: `No user transaction matched for ${exTx.normalisedAsset} ${exTx.normalisedType} at ${exTx.raw.timestamp}`,
        conflicts: [],
        matchScore: null,
      });
    }
  }

  logger.info("Matching phase complete", {
    runId,
    matched: results.filter((r) => r.category === "matched").length,
    conflicting: results.filter((r) => r.category === "conflicting").length,
    unmatchedUser: results.filter((r) => r.category === "unmatched_user").length,
    unmatchedExchange: results.filter((r) => r.category === "unmatched_exchange").length,
  });

  return results;
}

module.exports = { matchTransactions };
