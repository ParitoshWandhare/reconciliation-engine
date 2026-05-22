"use strict";

/**
 * Canonical asset symbol aliases.
 * Keys are all normalised to uppercase before lookup.
 */
const ASSET_ALIASES = {
  BITCOIN: "BTC",
  ETHEREUM: "ETH",
  SOLANA: "SOL",
  POLYGON: "MATIC",
  CARDANO: "ADA",
  POLKADOT: "DOT",
  AVALANCHE: "AVAX",
  CHAINLINK: "LINK",
  LITECOIN: "LTC",
  RIPPLE: "XRP",
  TETHER: "USDT",
  "USD COIN": "USDC",
  USDCOIN: "USDC",
};

/**
 * Normalise an asset symbol to its canonical uppercase ticker.
 * e.g. "bitcoin" → "BTC", "eth" → "ETH"
 * @param {string|null|undefined} raw
 * @returns {string|null}
 */
function normalizeAsset(raw) {
  if (raw == null || String(raw).trim() === "") return null;
  const upper = String(raw).trim().toUpperCase();
  return ASSET_ALIASES[upper] ?? upper;
}

module.exports = { normalizeAsset };
