"use strict";

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const config = require("../config");
const { connect } = require("../db/connection");
const { ingestAll } = require("../ingestion/ingestor");
const { matchTransactions } = require("../matching/matcher");
const { persistReport } = require("../reporting/reporter");
const ReconciliationRun = require("../db/models/ReconciliationRun");
const Transaction = require("../db/models/Transaction");
const logger = require("../utils/logger");

const router = express.Router();

/**
 * POST /reconcile
 *
 * Triggers a full reconciliation run.
 * Accepts optional body overrides for matching tolerances.
 *
 * Body (all optional):
 *   timestampToleranceSeconds {number}
 *   quantityTolerancePct      {number}
 *
 * Returns immediately with { runId } — the run executes asynchronously
 * so the caller can poll /report/:runId/summary.
 *
 * Design decision: async execution lets large datasets run without HTTP
 * timeout concerns; the runId is the handle for all follow-up queries.
 */
router.post("/", async (req, res) => {
  const runId = uuidv4();

  // Merge global config with any per-request overrides
  const matchConfig = {
    timestampToleranceSeconds:
      req.body?.timestampToleranceSeconds != null
        ? Number(req.body.timestampToleranceSeconds)
        : config.matching.timestampToleranceSeconds,
    quantityTolerancePct:
      req.body?.quantityTolerancePct != null
        ? Number(req.body.quantityTolerancePct)
        : config.matching.quantityTolerancePct,
  };

  if (
    !Number.isFinite(matchConfig.timestampToleranceSeconds) ||
    matchConfig.timestampToleranceSeconds < 0
  ) {
    return res.status(400).json({
      error: "timestampToleranceSeconds must be a non-negative number",
    });
  }
  if (
    !Number.isFinite(matchConfig.quantityTolerancePct) ||
    matchConfig.quantityTolerancePct < 0
  ) {
    return res
      .status(400)
      .json({ error: "quantityTolerancePct must be a non-negative number" });
  }

  // Create the run record immediately so the caller can start polling
  const run = await ReconciliationRun.create({
    runId,
    status: "pending",
    config: matchConfig,
  });

  logger.info("Reconciliation run created", { runId, matchConfig });

  // Respond before the heavy work starts
  res.status(202).json({
    runId,
    status: run.status,
    config: matchConfig,
    message: "Reconciliation started. Poll GET /report/:runId/summary for status.",
  });

  // ── Run asynchronously ────────────────────────────────────────────────────
  runReconciliation(runId, matchConfig).catch((err) => {
    logger.error("Reconciliation run failed", { runId, error: err.message, stack: err.stack });
  });
});

/**
 * Full reconciliation pipeline: ingest → match → report.
 */
async function runReconciliation(runId, matchConfig) {
  try {
    // 1. Ingestion
    await ReconciliationRun.updateOne({ runId }, { $set: { status: "ingesting" } });
    const ingestionStats = await ingestAll(runId);

    await ReconciliationRun.updateOne(
      { runId },
      {
        $set: {
          status: "matching",
          "summary.totalUser": ingestionStats.user.total,
          "summary.totalExchange": ingestionStats.exchange.total,
          "summary.invalidUser": ingestionStats.user.invalid,
          "summary.invalidExchange": ingestionStats.exchange.invalid,
        },
      }
    );

    // 2. Matching
    const matchResults = await matchTransactions(runId, matchConfig);

    // 3. Reporting
    await ReconciliationRun.updateOne({ runId }, { $set: { status: "reporting" } });
    await persistReport(runId, matchResults);

    logger.info("Reconciliation run complete", { runId });
  } catch (err) {
    await ReconciliationRun.updateOne(
      { runId },
      { $set: { status: "failed", error: err.message } }
    );
    throw err;
  }
}

module.exports = router;
