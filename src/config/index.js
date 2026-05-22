"use strict";

require("dotenv").config();

const config = {
  server: {
    port: parseInt(process.env.PORT, 10) || 3000,
    env: process.env.NODE_ENV || "development",
  },

  db: {
    uri: process.env.MONGODB_URI || "mongodb://localhost:27017/reconciliation",
    options: {
      serverSelectionTimeoutMS: 5000,
    },
  },

  matching: {
    timestampToleranceSeconds: parseFloat(
      process.env.TIMESTAMP_TOLERANCE_SECONDS ?? 300
    ),
    quantityTolerancePct: parseFloat(
      process.env.QUANTITY_TOLERANCE_PCT ?? 0.01
    ),
  },

  logging: {
    level: process.env.LOG_LEVEL || "info",
  },
};

module.exports = config;
