"use strict";

const mongoose = require("mongoose");

/**
 * Raw transaction as ingested from a CSV source.
 *
 * Design decisions:
 *  - `source` discriminates user vs exchange rows so both can live in one collection.
 *  - `normalised*` fields hold the cleaned values used for matching; originals are preserved.
 *  - `dataQualityIssues` is an array so multiple problems on one row are all captured.
 *  - `isValid` is a top-level boolean so queries can filter bad rows cheaply.
 *  - `runId` lets multiple ingestion runs coexist without dropping collections.
 */
const transactionSchema = new mongoose.Schema(
  {
    runId: { type: String, required: true, index: true },

    source: { type: String, enum: ["user", "exchange"], required: true },

    // ── Raw fields (exactly as they appeared in the CSV) ──────────────────────
    raw: {
      transaction_id: String,
      timestamp: String,
      type: String,
      asset: String,
      quantity: mongoose.Schema.Types.Mixed,
      price_usd: mongoose.Schema.Types.Mixed,
      fee: mongoose.Schema.Types.Mixed,
      note: String,
    },

    // ── Normalised fields (used by matching engine) ───────────────────────────
    normalisedTimestamp: { type: Date, default: null },
    normalisedType: { type: String, default: null },
    normalisedAsset: { type: String, default: null },
    normalisedQuantity: { type: Number, default: null },

    // ── Data quality ──────────────────────────────────────────────────────────
    isValid: { type: Boolean, default: true, index: true },
    dataQualityIssues: [
      {
        field: String,
        issue: String,
        rawValue: mongoose.Schema.Types.Mixed,
      },
    ],
  },
  {
    timestamps: true,
    collection: "transactions",
  }
);

transactionSchema.index({ runId: 1, source: 1, isValid: 1 });
transactionSchema.index({ runId: 1, normalisedTimestamp: 1 });

const Transaction = mongoose.model("Transaction", transactionSchema);

module.exports = Transaction;
