"use strict";

const mongoose = require("mongoose");
const config = require("../config");
const logger = require("../utils/logger");

let _connection = null;

async function connect() {
  if (_connection) return _connection;

  logger.info("Connecting to MongoDB", { uri: config.db.uri });

  _connection = await mongoose.connect(config.db.uri, config.db.options);

  mongoose.connection.on("error", (err) => {
    logger.error("MongoDB connection error", { error: err.message });
  });

  mongoose.connection.on("disconnected", () => {
    logger.warn("MongoDB disconnected");
    _connection = null;
  });

  logger.info("MongoDB connected successfully");
  return _connection;
}

async function disconnect() {
  if (!_connection) return;
  await mongoose.connection.close();
  _connection = null;
  logger.info("MongoDB disconnected gracefully");
}

module.exports = { connect, disconnect };
