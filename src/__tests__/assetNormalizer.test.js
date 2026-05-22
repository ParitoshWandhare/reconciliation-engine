"use strict";

const { normalizeAsset } = require("../utils/assetNormalizer");

describe("normalizeAsset", () => {
  test("returns uppercase ticker unchanged", () => {
    expect(normalizeAsset("BTC")).toBe("BTC");
    expect(normalizeAsset("ETH")).toBe("ETH");
  });

  test("normalises lowercase tickers", () => {
    expect(normalizeAsset("btc")).toBe("BTC");
    expect(normalizeAsset("eth")).toBe("ETH");
  });

  test("resolves full names to tickers", () => {
    expect(normalizeAsset("bitcoin")).toBe("BTC");
    expect(normalizeAsset("Bitcoin")).toBe("BTC");
    expect(normalizeAsset("BITCOIN")).toBe("BTC");
    expect(normalizeAsset("ethereum")).toBe("ETH");
    expect(normalizeAsset("Solana")).toBe("SOL");
  });

  test("returns null for empty or null input", () => {
    expect(normalizeAsset(null)).toBeNull();
    expect(normalizeAsset(undefined)).toBeNull();
    expect(normalizeAsset("")).toBeNull();
    expect(normalizeAsset("   ")).toBeNull();
  });

  test("preserves unknown tickers uppercased", () => {
    expect(normalizeAsset("doge")).toBe("DOGE");
    expect(normalizeAsset("NEWCOIN")).toBe("NEWCOIN");
  });
});
