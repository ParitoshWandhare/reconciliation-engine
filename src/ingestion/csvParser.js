"use strict";

const fs = require("fs");
const { parse } = require("csv-parse");
const { normalizeAsset } = require("../utils/assetNormalizer");
const { normalizeType } = require("../utils/typeNormalizer");
const logger = require("../utils/logger");

/**
 * Parse a raw CSV value as a finite positive number.
 * Returns the number or null on failure.
 */
function parseNumber(raw) {
  if (raw == null || String(raw).trim() === "" || String(raw).trim() === "N/A")
    return null;
  const n = parseFloat(String(raw).trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * Attempt to parse a timestamp string.
 * Handles ISO 8601 and truncated forms like "2024-03-09T" (flags as invalid).
 * Returns { date: Date|null, issue: string|null }
 */
function parseTimestamp(raw) {
  if (raw == null || String(raw).trim() === "")
    return { date: null, issue: "missing timestamp" };

  const trimmed = String(raw).trim();

  // Attempt direct ISO parse
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) return { date: d, issue: null };

  // Truncated ISO (e.g. "2024-03-09T")
  if (/^\d{4}-\d{2}-\d{2}T$/.test(trimmed))
    return {
      date: null,
      issue: `malformed timestamp: truncated ISO string "${trimmed}"`,
    };

  return { date: null, issue: `unparseable timestamp: "${trimmed}"` };
}

/**
 * Validate and normalise a single parsed CSV row.
 * Returns a normalised transaction document ready for MongoDB.
 *
 * Policy: we never silently drop rows. A row with issues gets isValid=false
 * and dataQualityIssues populated so it is still stored and reported.
 */
function validateRow(raw, source, rowIndex) {
  const issues = [];

  // ── transaction_id ────────────────────────────────────────────────────────
  if (!raw.transaction_id || String(raw.transaction_id).trim() === "") {
    issues.push({ field: "transaction_id", issue: "missing transaction_id", rawValue: raw.transaction_id });
  }

  // ── timestamp ─────────────────────────────────────────────────────────────
  const { date: normalisedTimestamp, issue: tsIssue } = parseTimestamp(raw.timestamp);
  if (tsIssue) {
    issues.push({ field: "timestamp", issue: tsIssue, rawValue: raw.timestamp });
  }

  // ── type ──────────────────────────────────────────────────────────────────
  const normalisedType = normalizeType(raw.type);
  if (!normalisedType) {
    issues.push({
      field: "type",
      issue: raw.type == null || String(raw.type).trim() === ""
        ? "missing transaction type"
        : `unrecognised transaction type: "${raw.type}"`,
      rawValue: raw.type,
    });
  }

  // ── asset ─────────────────────────────────────────────────────────────────
  const normalisedAsset = normalizeAsset(raw.asset);
  if (!normalisedAsset) {
    issues.push({ field: "asset", issue: "missing asset symbol", rawValue: raw.asset });
  }

  // ── quantity ──────────────────────────────────────────────────────────────
  const normalisedQuantity = parseNumber(raw.quantity);
  if (normalisedQuantity == null) {
    issues.push({ field: "quantity", issue: "missing or non-numeric quantity", rawValue: raw.quantity });
  } else if (normalisedQuantity < 0) {
    issues.push({ field: "quantity", issue: `negative quantity: ${normalisedQuantity}`, rawValue: raw.quantity });
  }

  // ── price_usd (optional field, but flag clearly non-numeric values) ───────
  const price = parseNumber(raw.price_usd);
  if (raw.price_usd != null && String(raw.price_usd).trim() !== "" && price == null) {
    issues.push({ field: "price_usd", issue: `non-numeric price_usd: "${raw.price_usd}"`, rawValue: raw.price_usd });
  }

  // ── fee (optional) ────────────────────────────────────────────────────────
  const fee = parseNumber(raw.fee);
  if (raw.fee != null && String(raw.fee).trim() !== "" && fee == null) {
    issues.push({ field: "fee", issue: `non-numeric fee: "${raw.fee}"`, rawValue: raw.fee });
  }

  const isValid =
    issues.length === 0 ||
    issues.every((i) => !["timestamp", "type", "asset", "quantity"].includes(i.field));

  // A row is only usable for matching if the core matching fields are clean
  const hasCriticalIssue = issues.some((i) =>
    ["timestamp", "type", "asset", "quantity"].includes(i.field)
  );

  return {
    source,
    raw: {
      transaction_id: raw.transaction_id ?? null,
      timestamp: raw.timestamp ?? null,
      type: raw.type ?? null,
      asset: raw.asset ?? null,
      quantity: raw.quantity ?? null,
      price_usd: raw.price_usd ?? null,
      fee: raw.fee ?? null,
      note: raw.note ?? null,
    },
    normalisedTimestamp: normalisedTimestamp,
    normalisedType: normalisedType,
    normalisedAsset: normalisedAsset,
    normalisedQuantity: normalisedQuantity,
    isValid: !hasCriticalIssue,
    dataQualityIssues: issues,
  };
}

/**
 * Parse a CSV file, validate all rows, return { records, stats }.
 * @param {string} filePath
 * @param {"user"|"exchange"} source
 * @returns {Promise<{ records: object[], stats: object }>}
 */
async function parseCsvFile(filePath, source) {
  return new Promise((resolve, reject) => {
    const records = [];
    let rowIndex = 0;
    let duplicateIds = 0;
    const seenIds = new Set();

    const parser = fs
      .createReadStream(filePath)
      .pipe(
        parse({
          columns: true,          // use header row as keys
          trim: true,
          skip_empty_lines: true,
          relax_column_count: true, // don't crash on ragged rows
        })
      );

    parser.on("readable", () => {
      let row;
      while ((row = parser.read()) !== null) {
        rowIndex++;
        const doc = validateRow(row, source, rowIndex);

        // Detect duplicate transaction IDs within this file
        const id = doc.raw.transaction_id;
        if (id && seenIds.has(id)) {
          duplicateIds++;
          doc.dataQualityIssues.push({
            field: "transaction_id",
            issue: `duplicate transaction_id within ${source} file`,
            rawValue: id,
          });
          doc.isValid = false;
        } else if (id) {
          seenIds.add(id);
        }

        if (doc.dataQualityIssues.length > 0) {
          logger.warn("Data quality issue detected", {
            source,
            rowIndex,
            transactionId: doc.raw.transaction_id,
            issues: doc.dataQualityIssues,
          });
        }

        records.push(doc);
      }
    });

    parser.on("error", reject);

    parser.on("end", () => {
      const valid = records.filter((r) => r.isValid).length;
      const invalid = records.length - valid;

      logger.info("CSV parsing complete", {
        source,
        total: records.length,
        valid,
        invalid,
        duplicateIds,
      });

      resolve({
        records,
        stats: {
          total: records.length,
          valid,
          invalid,
          duplicateIds,
        },
      });
    });
  });
}

module.exports = { parseCsvFile };
