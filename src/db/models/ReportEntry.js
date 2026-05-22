"use strict";

const mongoose = require("mongoose");

/**
 * One entry in the reconciliation report.
 *
 * Design decisions:
 *  - Embeds a snapshot of both sides' raw data so the report is self-contained
 *    and does not require joining back to the transactions collection.
 *  - `category` drives the high-level classification.
 *  - `reason` is a human-readable explanation (used heavily in unmatched reports).
 *  - `conflicts` is an array to capture multiple field-level discrepancies at once.
 */

const rawSnapshotSchema = new mongoose.Schema(
  {
    transactionId: String,
    internalId: mongoose.Schema.Types.ObjectId,
    timestamp: String,
    type: String,
    asset: String,
    quantity: mongoose.Schema.Types.Mixed,
    price_usd: mongoose.Schema.Types.Mixed,
    fee: mongoose.Schema.Types.Mixed,
    note: String,
  },
  { _id: false }
);

const conflictDetailSchema = new mongoose.Schema(
  {
    field: String,
    userValue: mongoose.Schema.Types.Mixed,
    exchangeValue: mongoose.Schema.Types.Mixed,
    delta: mongoose.Schema.Types.Mixed,
    tolerance: mongoose.Schema.Types.Mixed,
  },
  { _id: false }
);

const reportEntrySchema = new mongoose.Schema(
  {
    runId: { type: String, required: true, index: true },

    category: {
      type: String,
      enum: ["matched", "conflicting", "unmatched_user", "unmatched_exchange"],
      required: true,
      index: true,
    },

    reason: { type: String, required: true },

    userSide: { type: rawSnapshotSchema, default: null },
    exchangeSide: { type: rawSnapshotSchema, default: null },

    conflicts: { type: [conflictDetailSchema], default: [] },

    /** Similarity score (0–1) used during matching; retained for auditability. */
    matchScore: { type: Number, default: null },
  },
  {
    timestamps: true,
    collection: "report_entries",
  }
);

reportEntrySchema.index({ runId: 1, category: 1 });

const ReportEntry = mongoose.model("ReportEntry", reportEntrySchema);

module.exports = ReportEntry;
