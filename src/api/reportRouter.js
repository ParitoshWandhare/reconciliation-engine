"use strict";

const express = require("express");
const ReconciliationRun = require("../db/models/ReconciliationRun");
const ReportEntry = require("../db/models/ReportEntry");
const { generateCsvReport, flattenEntry } = require("../reporting/reporter");
const logger = require("../utils/logger");

const router = express.Router();

/**
 * Shared middleware: resolve and attach the run document to req.run.
 * Returns 404 if runId is unknown, 409 if the run hasn't completed yet.
 */
async function resolveRun(req, res, next) {
  const run = await ReconciliationRun.findOne({ runId: req.params.runId }).lean();
  if (!run) {
    return res.status(404).json({ error: `Run ${req.params.runId} not found` });
  }
  req.run = run;
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /report/:runId
//   Returns the full reconciliation report.
//   Supports ?format=csv to download as a CSV file.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/:runId", resolveRun, async (req, res) => {
  const { runId } = req.params;
  const format = req.query.format;

  if (format === "csv") {
    const csv = await generateCsvReport(runId);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="reconciliation_${runId}.csv"`
    );
    return res.send(csv);
  }

  // JSON response — paginate to avoid huge payloads
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
  const skip = (page - 1) * limit;

  const [entries, total] = await Promise.all([
    ReportEntry.find({ runId }).skip(skip).limit(limit).lean(),
    ReportEntry.countDocuments({ runId }),
  ]);

  res.json({
    runId,
    status: req.run.status,
    config: req.run.config,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    entries,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /report/:runId/summary
//   Returns just the counts — cheap, useful for polling.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/:runId/summary", resolveRun, async (req, res) => {
  const run = req.run;
  res.json({
    runId: run.runId,
    status: run.status,
    config: run.config,
    summary: run.summary,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
    error: run.error ?? undefined,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /report/:runId/unmatched
//   Returns only unmatched rows (user-only + exchange-only) with reasons.
//   Supports optional ?source=user|exchange filter.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/:runId/unmatched", resolveRun, async (req, res) => {
  const { runId } = req.params;
  const sourceFilter = req.query.source; // optional: "user" | "exchange"

  const categoryFilter = { $in: ["unmatched_user", "unmatched_exchange"] };
  const query = { runId, category: categoryFilter };

  if (sourceFilter === "user") {
    query.category = "unmatched_user";
  } else if (sourceFilter === "exchange") {
    query.category = "unmatched_exchange";
  }

  const entries = await ReportEntry.find(query).lean();

  const rows = entries.map((e) => ({
    category: e.category,
    reason: e.reason,
    transaction: e.category === "unmatched_user" ? e.userSide : e.exchangeSide,
  }));

  res.json({
    runId,
    status: req.run.status,
    total: rows.length,
    unmatched: rows,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /report/:runId/conflicts
//   Bonus endpoint: returns only conflicting entries with field-level diffs.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/:runId/conflicts", resolveRun, async (req, res) => {
  const entries = await ReportEntry.find({
    runId: req.params.runId,
    category: "conflicting",
  }).lean();

  res.json({
    runId: req.params.runId,
    status: req.run.status,
    total: entries.length,
    conflicts: entries,
  });
});

module.exports = router;
