"use strict";

const express = require("express");
const reconcileRouter = require("./reconcileRouter");
const reportRouter = require("./reportRouter");
const logger = require("../utils/logger");

function createApp() {
  const app = express();

  // ── Middleware ──────────────────────────────────────────────────────────────
  app.use(express.json());

  // Request logging
  app.use((req, _res, next) => {
    logger.info("Incoming request", {
      method: req.method,
      path: req.path,
      query: req.query,
    });
    next();
  });

  // ── Routes ──────────────────────────────────────────────────────────────────
  app.get("/health", (_req, res) =>
    res.json({ status: "ok", timestamp: new Date().toISOString() })
  );

  app.use("/reconcile", reconcileRouter);
  app.use("/report", reportRouter);

  // ── 404 handler ─────────────────────────────────────────────────────────────
  app.use((_req, res) => {
    res.status(404).json({ error: "Route not found" });
  });

  // ── Global error handler ─────────────────────────────────────────────────────
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    logger.error("Unhandled error", { error: err.message, stack: err.stack });
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

module.exports = { createApp };
