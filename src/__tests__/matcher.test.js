"use strict";

jest.mock("../db/models/Transaction");

const Transaction = require("../db/models/Transaction");
const { matchTransactions } = require("../matching/matcher");

const DEFAULT_CONFIG = {
  timestampToleranceSeconds: 300,
  quantityTolerancePct: 0.01,
};

/** Helper: build a minimal transaction doc */
function makeTx(overrides = {}) {
  return {
    _id: { toString: () => overrides.id ?? String(Math.random()) },
    source: overrides.source ?? "user",
    raw: {
      transaction_id: overrides.txId ?? "TX-000",
      timestamp: overrides.timestamp ?? "2024-03-01T09:00:00Z",
      type: overrides.type ?? "BUY",
      asset: overrides.asset ?? "BTC",
      quantity: overrides.quantity ?? 0.5,
      price_usd: overrides.price_usd ?? 62000,
      fee: overrides.fee ?? 0.0005,
      note: overrides.note ?? null,
    },
    normalisedTimestamp: new Date(overrides.timestamp ?? "2024-03-01T09:00:00Z"),
    normalisedType: overrides.type ?? "BUY",
    normalisedAsset: overrides.asset ?? "BTC",
    normalisedQuantity: overrides.quantity ?? 0.5,
    isValid: true,
  };
}

describe("matchTransactions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("matches two identical transactions", async () => {
    const userTx = makeTx({ id: "u1", source: "user" });
    const exTx = makeTx({ id: "e1", source: "exchange" });

    Transaction.find.mockImplementation(({ source }) => ({
      lean: () =>
        Promise.resolve(source === "user" ? [userTx] : [exTx]),
    }));

    const results = await matchTransactions("run-1", DEFAULT_CONFIG);

    expect(results).toHaveLength(1);
    expect(results[0].category).toBe("matched");
  });

  test("matches TRANSFER_OUT (user) with TRANSFER_IN (exchange)", async () => {
    const userTx = makeTx({ id: "u2", source: "user", type: "TRANSFER_OUT" });
    const exTx = makeTx({ id: "e2", source: "exchange", type: "TRANSFER_IN" });

    Transaction.find.mockImplementation(({ source }) => ({
      lean: () =>
        Promise.resolve(source === "user" ? [userTx] : [exTx]),
    }));

    const results = await matchTransactions("run-2", DEFAULT_CONFIG);

    expect(results).toHaveLength(1);
    expect(results[0].category).toBe("matched");
  });

  test("marks as unmatched_user when no exchange tx exists", async () => {
    const userTx = makeTx({ id: "u3", source: "user" });

    Transaction.find.mockImplementation(({ source }) => ({
      lean: () => Promise.resolve(source === "user" ? [userTx] : []),
    }));

    const results = await matchTransactions("run-3", DEFAULT_CONFIG);

    expect(results).toHaveLength(1);
    expect(results[0].category).toBe("unmatched_user");
  });

  test("marks as unmatched_exchange when no user tx exists", async () => {
    const exTx = makeTx({ id: "e4", source: "exchange" });

    Transaction.find.mockImplementation(({ source }) => ({
      lean: () => Promise.resolve(source === "user" ? [] : [exTx]),
    }));

    const results = await matchTransactions("run-4", DEFAULT_CONFIG);

    expect(results).toHaveLength(1);
    expect(results[0].category).toBe("unmatched_exchange");
  });

  test("marks as conflicting when quantity exceeds tolerance", async () => {
    const userTx = makeTx({ id: "u5", source: "user", quantity: 0.5 });
    // 0.3001 vs 0.3000 = 0.033% difference — outside default 0.01%
    const exTx = makeTx({ id: "e5", source: "exchange", quantity: 0.3001 });

    Transaction.find.mockImplementation(({ source }) => ({
      lean: () =>
        Promise.resolve(source === "user" ? [userTx] : [exTx]),
    }));

    const results = await matchTransactions("run-5", DEFAULT_CONFIG);

    expect(results[0].category).toBe("conflicting");
    expect(results[0].conflicts.some((c) => c.field === "quantity")).toBe(true);
  });

  test("marks as conflicting when timestamp exceeds tolerance", async () => {
    const userTx = makeTx({
      id: "u6",
      source: "user",
      timestamp: "2024-03-01T09:00:00Z",
    });
    // 10 minutes later — outside default 5-minute window
    const exTx = makeTx({
      id: "e6",
      source: "exchange",
      timestamp: "2024-03-01T09:10:00Z",
    });

    Transaction.find.mockImplementation(({ source }) => ({
      lean: () =>
        Promise.resolve(source === "user" ? [userTx] : [exTx]),
    }));

    const results = await matchTransactions("run-6", DEFAULT_CONFIG);

    // The exchange tx is outside the time window, so no candidate found
    expect(results[0].category).toBe("unmatched_user");
  });

  test("does not double-match a single exchange tx", async () => {
    const userTx1 = makeTx({ id: "u7a", source: "user" });
    const userTx2 = makeTx({ id: "u7b", source: "user" });
    const exTx = makeTx({ id: "e7", source: "exchange" });

    Transaction.find.mockImplementation(({ source }) => ({
      lean: () =>
        Promise.resolve(source === "user" ? [userTx1, userTx2] : [exTx]),
    }));

    const results = await matchTransactions("run-7", DEFAULT_CONFIG);

    const matched = results.filter((r) => r.category === "matched");
    const unmatched = results.filter((r) => r.category === "unmatched_user");

    expect(matched).toHaveLength(1);
    expect(unmatched).toHaveLength(1);
  });

  test("respects custom tolerance config", async () => {
    const looseConfig = {
      timestampToleranceSeconds: 3600, // 1 hour
      quantityTolerancePct: 1.0,       // 100%
    };

    const userTx = makeTx({
      id: "u8",
      source: "user",
      quantity: 0.5,
      timestamp: "2024-03-01T09:00:00Z",
    });
    const exTx = makeTx({
      id: "e8",
      source: "exchange",
      quantity: 0.3001,
      timestamp: "2024-03-01T09:30:00Z",
    });

    Transaction.find.mockImplementation(({ source }) => ({
      lean: () =>
        Promise.resolve(source === "user" ? [userTx] : [exTx]),
    }));

    const results = await matchTransactions("run-8", looseConfig);

    expect(results[0].category).toBe("matched");
  });
});
