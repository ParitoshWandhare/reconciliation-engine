"use strict";

/**
 * Canonical transaction types after normalisation.
 */
const CANONICAL_TYPES = new Set(["BUY", "SELL", "TRANSFER_IN", "TRANSFER_OUT"]);

/**
 * Types that are the same economic event viewed from opposite perspectives.
 * TRANSFER_IN on exchange side == TRANSFER_OUT on user side (and vice-versa).
 */
const PERSPECTIVE_EQUIVALENTS = {
  TRANSFER_IN: "TRANSFER_OUT",
  TRANSFER_OUT: "TRANSFER_IN",
};

/**
 * Normalise a raw type string to uppercase canonical form.
 * Returns null if the value is unrecognisable.
 * @param {string|null|undefined} raw
 * @returns {string|null}
 */
function normalizeType(raw) {
  if (raw == null || String(raw).trim() === "") return null;
  const upper = String(raw).trim().toUpperCase();
  // Accept direct match
  if (CANONICAL_TYPES.has(upper)) return upper;
  return null;
}

/**
 * Return true when typeA and typeB represent the same transaction
 * (either identical, or perspective-flipped transfers).
 * @param {string} typeA
 * @param {string} typeB
 * @returns {boolean}
 */
function typesAreCompatible(typeA, typeB) {
  if (typeA === typeB) return true;
  return PERSPECTIVE_EQUIVALENTS[typeA] === typeB;
}

module.exports = { normalizeType, typesAreCompatible, CANONICAL_TYPES };
