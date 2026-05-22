"use strict";

const mongoose = require("mongoose");

/**
 * Top-level record for a reconciliation run.
 * Stores configuration used and aggregate counts for quick summary queries.
 */
const reconciliationRunSchema = new mongoose.Schema(
  {
    runId: { type: String, required: true, unique: true, index: true },

    status: {
      type: String,
      enum: ["pending", "ingesting", "matching", "reporting", "complete", "failed"],
      default: "pending",
    },

    config: {
      timestampToleranceSeconds: { type: Number, required: true },
      quantityTolerancePct: { type: Number, required: true },
    },

    summary: {
      matched: { type: Number, default: 0 },
      conflicting: { type: Number, default: 0 },
      unmatchedUser: { type: Number, default: 0 },
      unmatchedExchange: { type: Number, default: 0 },
      totalUser: { type: Number, default: 0 },
      totalExchange: { type: Number, default: 0 },
      invalidUser: { type: Number, default: 0 },
      invalidExchange: { type: Number, default: 0 },
    },

    error: { type: String, default: null },
    completedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: "reconciliation_runs",
  }
);

const ReconciliationRun = mongoose.model(
  "ReconciliationRun",
  reconciliationRunSchema
);

module.exports = ReconciliationRun;
