"use strict";

const { normalizeType, typesAreCompatible } = require("../utils/typeNormalizer");

describe("normalizeType", () => {
  test("returns canonical uppercase types", () => {
    expect(normalizeType("BUY")).toBe("BUY");
    expect(normalizeType("SELL")).toBe("SELL");
    expect(normalizeType("TRANSFER_IN")).toBe("TRANSFER_IN");
    expect(normalizeType("TRANSFER_OUT")).toBe("TRANSFER_OUT");
  });

  test("normalises lowercase input", () => {
    expect(normalizeType("buy")).toBe("BUY");
    expect(normalizeType("sell")).toBe("SELL");
    expect(normalizeType("transfer_in")).toBe("TRANSFER_IN");
  });

  test("returns null for unrecognised types", () => {
    expect(normalizeType("SWAP")).toBeNull();
    expect(normalizeType("DEPOSIT")).toBeNull();
    expect(normalizeType("")).toBeNull();
    expect(normalizeType(null)).toBeNull();
    expect(normalizeType(undefined)).toBeNull();
  });
});

describe("typesAreCompatible", () => {
  test("identical types are compatible", () => {
    expect(typesAreCompatible("BUY", "BUY")).toBe(true);
    expect(typesAreCompatible("SELL", "SELL")).toBe(true);
  });

  test("TRANSFER_IN and TRANSFER_OUT are perspective equivalents", () => {
    expect(typesAreCompatible("TRANSFER_IN", "TRANSFER_OUT")).toBe(true);
    expect(typesAreCompatible("TRANSFER_OUT", "TRANSFER_IN")).toBe(true);
  });

  test("different non-transfer types are incompatible", () => {
    expect(typesAreCompatible("BUY", "SELL")).toBe(false);
    expect(typesAreCompatible("BUY", "TRANSFER_IN")).toBe(false);
  });
});
