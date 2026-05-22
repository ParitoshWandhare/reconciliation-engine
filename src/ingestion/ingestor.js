"use strict";

const path = require("path");
const { parseCsvFile } = require("./csvParser");
const Transaction = require("../db/models/Transaction");
const logger = require("../utils/logger");

const DATA_DIR = path.resolve(__dirname, "../../data");

/**
 * Ingest both CSV files for a given runId.
 * Returns summary stats for the run record.
 *
 * @param {string} runId
 * @param {{ userFile?: string, exchangeFile?: string }} [options]
 * @returns {Promise<{ user: object, exchange: object }>}
 */
async function ingestAll(runId, options = {}) {
  const userFile = options.userFile ?? path.join(DATA_DIR, "user_transactions.csv");
  const exchangeFile = options.exchangeFile ?? path.join(DATA_DIR, "exchange_transactions.csv");

  logger.info("Starting ingestion", { runId, userFile, exchangeFile });

  const [userResult, exchangeResult] = await Promise.all([
    parseCsvFile(userFile, "user"),
    parseCsvFile(exchangeFile, "exchange"),
  ]);

  // Stamp runId onto every document before bulk insert
  const userDocs = userResult.records.map((r) => ({ ...r, runId }));
  const exchangeDocs = exchangeResult.records.map((r) => ({ ...r, runId }));

  const allDocs = [...userDocs, ...exchangeDocs];

  if (allDocs.length > 0) {
    await Transaction.insertMany(allDocs, { ordered: false });
  }

  logger.info("Ingestion complete", {
    runId,
    user: userResult.stats,
    exchange: exchangeResult.stats,
  });

  return {
    user: userResult.stats,
    exchange: exchangeResult.stats,
  };
}

module.exports = { ingestAll };
