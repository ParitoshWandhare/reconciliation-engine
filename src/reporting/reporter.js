"use strict";

const { stringify } = require("csv-parse/sync");
// csv-parse/sync doesn't have stringify; use csv-stringify instead approach with manual CSV
const ReportEntry = require("../db/models/ReportEntry");
const ReconciliationRun = require("../db/models/ReconciliationRun");
const logger = require("../utils/logger");

/**
 * Build a raw snapshot object from a transaction document.
 */
function buildSnapshot(tx) {
  if (!tx) return null;
  return {
    transactionId: tx.raw?.transaction_id ?? null,
    internalId: tx._id,
    timestamp: tx.raw?.timestamp ?? null,
    type: tx.raw?.type ?? null,
    asset: tx.raw?.asset ?? null,
    quantity: tx.raw?.quantity ?? null,
    price_usd: tx.raw?.price_usd ?? null,
    fee: tx.raw?.fee ?? null,
    note: tx.raw?.note ?? null,
  };
}

/**
 * Persist all match results as ReportEntry documents and update the run summary.
 *
 * @param {string} runId
 * @param {Array} matchResults
 * @returns {Promise<object>} summary counts
 */
async function persistReport(runId, matchResults) {
  logger.info("Persisting report entries", { runId, count: matchResults.length });

  const entries = matchResults.map((r) => ({
    runId,
    category: r.category,
    reason: r.reason,
    userSide: buildSnapshot(r.userTx),
    exchangeSide: buildSnapshot(r.exchangeTx),
    conflicts: r.conflicts ?? [],
    matchScore: r.matchScore ?? null,
  }));

  // Bulk insert in batches to avoid hitting document size limits
  const BATCH_SIZE = 500;
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    await ReportEntry.insertMany(entries.slice(i, i + BATCH_SIZE), {
      ordered: false,
    });
  }

  const summary = {
    matched: matchResults.filter((r) => r.category === "matched").length,
    conflicting: matchResults.filter((r) => r.category === "conflicting").length,
    unmatchedUser: matchResults.filter((r) => r.category === "unmatched_user").length,
    unmatchedExchange: matchResults.filter((r) => r.category === "unmatched_exchange").length,
  };

  await ReconciliationRun.updateOne(
    { runId },
    {
      $set: {
        "summary.matched": summary.matched,
        "summary.conflicting": summary.conflicting,
        "summary.unmatchedUser": summary.unmatchedUser,
        "summary.unmatchedExchange": summary.unmatchedExchange,
        status: "complete",
        completedAt: new Date(),
      },
    }
  );

  logger.info("Report persisted", { runId, summary });
  return summary;
}

/**
 * Flatten a ReportEntry document into a CSV-ready flat object.
 */
function flattenEntry(entry) {
  const u = entry.userSide ?? {};
  const e = entry.exchangeSide ?? {};
  return {
    run_id: entry.runId,
    category: entry.category,
    reason: entry.reason,
    match_score: entry.matchScore ?? "",

    // User side
    user_transaction_id: u.transactionId ?? "",
    user_timestamp: u.timestamp ?? "",
    user_type: u.type ?? "",
    user_asset: u.asset ?? "",
    user_quantity: u.quantity ?? "",
    user_price_usd: u.price_usd ?? "",
    user_fee: u.fee ?? "",
    user_note: u.note ?? "",

    // Exchange side
    exchange_transaction_id: e.transactionId ?? "",
    exchange_timestamp: e.timestamp ?? "",
    exchange_type: e.type ?? "",
    exchange_asset: e.asset ?? "",
    exchange_quantity: e.quantity ?? "",
    exchange_price_usd: e.price_usd ?? "",
    exchange_fee: e.fee ?? "",
    exchange_note: e.note ?? "",

    // Conflict details (serialised for readability)
    conflicts: entry.conflicts?.length
      ? entry.conflicts
          .map((c) => `${c.field}: user=${c.userValue} exchange=${c.exchangeValue} delta=${c.delta} tol=${c.tolerance}`)
          .join(" | ")
      : "",
  };
}

/**
 * Escape a CSV field value: wrap in quotes and escape internal quotes.
 */
function csvEscape(val) {
  const s = val == null ? "" : String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Convert an array of objects to a CSV string.
 */
function toCsvString(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => csvEscape(r[h])).join(",")),
  ];
  return lines.join("\n");
}

/**
 * Generate a CSV string for the full report of a run.
 * @param {string} runId
 * @returns {Promise<string>}
 */
async function generateCsvReport(runId) {
  const entries = await ReportEntry.find({ runId }).lean();
  const rows = entries.map(flattenEntry);
  return toCsvString(rows);
}

module.exports = { persistReport, generateCsvReport, flattenEntry };
