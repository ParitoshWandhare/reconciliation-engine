"use strict";

const { createLogger, format, transports } = require("winston");
const config = require("../config");

const logger = createLogger({
  level: config.logging.level,
  format: format.combine(
    format.timestamp({ format: "YYYY-MM-DDTHH:mm:ss.SSSZ" }),
    format.errors({ stack: true }),
    format.json()
  ),
  defaultMeta: { service: "reconciliation-engine" },
  transports: [
    new transports.Console({
      format:
        config.server.env === "development"
          ? format.combine(
              format.colorize(),
              format.printf(({ timestamp, level, message, ...meta }) => {
                const metaStr = Object.keys(meta).length
                  ? ` ${JSON.stringify(meta)}`
                  : "";
                return `${timestamp} [${level}]: ${message}${metaStr}`;
              })
            )
          : format.json(),
    }),
  ],
});

module.exports = logger;
