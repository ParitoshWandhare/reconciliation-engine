"use strict";

const { connect } = require("./db/connection");
const { createApp } = require("./api/app");
const config = require("./config");
const logger = require("./utils/logger");

async function main() {
  await connect();

  const app = createApp();
  const server = app.listen(config.server.port, () => {
    logger.info("Server started", {
      port: config.server.port,
      env: config.server.env,
    });
  });

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  const shutdown = async (signal) => {
    logger.info(`${signal} received, shutting down gracefully`);
    server.close(async () => {
      const { disconnect } = require("./db/connection");
      await disconnect();
      logger.info("Server closed");
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled promise rejection", { reason: String(reason) });
  });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
