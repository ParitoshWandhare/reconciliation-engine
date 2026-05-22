# Transaction Reconciliation Engine

A production-grade Node.js service that ingests crypto transaction data from two sources (user-exported and exchange-exported CSVs), matches them using a configurable tolerance engine, and produces a structured reconciliation report via a REST API.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Architecture & Key Decisions](#architecture--key-decisions)
- [Data Quality Handling](#data-quality-handling)
- [Matching Algorithm](#matching-algorithm)
- [Running Tests](#running-tests)

---

## Quick Start

### Prerequisites

- Node.js ≥ 18
- MongoDB (local or remote)

### Setup

```bash
git clone <your-repo-url>
cd transaction-reconciliation-engine

npm install

cp .env.example .env
# Edit .env with your MongoDB URI and any tolerance overrides

npm start
```

Place your CSV files in the `data/` directory:
- `data/user_transactions.csv`
- `data/exchange_transactions.csv`

### Trigger a reconciliation run

```bash
# Start a run with default tolerances
curl -X POST http://localhost:3000/reconcile

# Start a run with custom tolerances
curl -X POST http://localhost:3000/reconcile \
  -H "Content-Type: application/json" \
  -d '{"timestampToleranceSeconds": 60, "quantityTolerancePct": 0.05}'
```

The response immediately returns a `runId`. Use it to poll for results:

```bash
# Check run status and summary counts
curl http://localhost:3000/report/<runId>/summary

# Fetch the full report (JSON, paginated)
curl http://localhost:3000/report/<runId>

# Download the full report as CSV
curl "http://localhost:3000/report/<runId>?format=csv" -o report.csv

# Fetch only unmatched rows
curl http://localhost:3000/report/<runId>/unmatched

# Fetch only conflicting rows
curl http://localhost:3000/report/<runId>/conflicts
```

---

## Project Structure

```
src/
├── config/
│   └── index.js              # Central config; reads from env vars
├── db/
│   ├── connection.js          # Mongoose connect/disconnect
│   └── models/
│       ├── Transaction.js     # Raw transaction schema (user + exchange)
│       ├── ReconciliationRun.js  # Run metadata + summary counts
│       └── ReportEntry.js     # One entry per reconciliation result
├── ingestion/
│   ├── csvParser.js           # CSV parsing + per-row validation
│   └── ingestor.js            # Orchestrates parsing and DB insert
├── matching/
│   └── matcher.js             # Two-phase matching engine
├── reporting/
│   └── reporter.js            # Persists results + CSV generation
├── api/
│   ├── app.js                 # Express app factory
│   ├── reconcileRouter.js     # POST /reconcile
│   └── reportRouter.js        # GET /report/:runId/*
├── utils/
│   ├── assetNormalizer.js     # BTC/Bitcoin alias resolution
│   ├── typeNormalizer.js      # Type canonicalisation + perspective flip
│   └── logger.js              # Winston structured logger
├── __tests__/                 # Jest unit + integration tests
└── index.js                   # Entry point
data/
├── user_transactions.csv
└── exchange_transactions.csv
```

---

## Configuration

All tolerances can be set without code changes via:

1. **Environment variables** (`.env` file or process env)
2. **Request body** on `POST /reconcile` (overrides env for that run only)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP server port |
| `MONGODB_URI` | `mongodb://localhost:27017/reconciliation` | MongoDB connection string |
| `TIMESTAMP_TOLERANCE_SECONDS` | `300` | Max timestamp diff for a match (seconds) |
| `QUANTITY_TOLERANCE_PCT` | `0.01` | Max quantity diff as a fraction (0.01 = 1%) |
| `LOG_LEVEL` | `info` | Winston log level |

---

## API Reference

### `POST /reconcile`

Starts an asynchronous reconciliation run. Returns immediately with a `runId`.

**Request body (all optional):**
```json
{
  "timestampToleranceSeconds": 300,
  "quantityTolerancePct": 0.01
}
```

**Response `202`:**
```json
{
  "runId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "config": { "timestampToleranceSeconds": 300, "quantityTolerancePct": 0.01 },
  "message": "Reconciliation started. Poll GET /report/:runId/summary for status."
}
```

---

### `GET /report/:runId/summary`

Returns aggregate counts and run status. Cheap — useful for polling.

```json
{
  "runId": "...",
  "status": "complete",
  "config": { "timestampToleranceSeconds": 300, "quantityTolerancePct": 0.01 },
  "summary": {
    "matched": 20,
    "conflicting": 1,
    "unmatchedUser": 3,
    "unmatchedExchange": 2,
    "totalUser": 26,
    "totalExchange": 25,
    "invalidUser": 3,
    "invalidExchange": 0
  },
  "createdAt": "...",
  "completedAt": "..."
}
```

---

### `GET /report/:runId`

Full paginated report. Add `?format=csv` to download as a CSV file.

Query params: `page` (default 1), `limit` (default 100, max 500), `format=csv`

---

### `GET /report/:runId/unmatched`

Returns only unmatched rows with reasons.

Query params: `source=user|exchange` (optional filter)

---

### `GET /report/:runId/conflicts`

Returns only conflicting rows with field-level diff details.

---

## Architecture & Key Decisions

### Async reconciliation with polling

`POST /reconcile` returns a `runId` immediately and runs the pipeline in the background. This prevents HTTP timeout issues on large datasets and follows the common webhook/polling pattern used in production data pipelines.

### One collection for both transaction sources

Both user and exchange transactions share a single `transactions` collection, discriminated by a `source` field. This simplifies time-window queries (a single index on `(runId, source, normalisedTimestamp)` covers both sides) and keeps the schema DRY.

### Raw fields preserved alongside normalised fields

Every transaction document stores the original CSV values in `raw.*` alongside the cleaned `normalised*` fields. This means the report is fully auditable — you can always see what was in the source file versus what the engine computed.

### Invalid rows are never dropped

Rows with data quality issues are flagged with `isValid: false` and a populated `dataQualityIssues` array, but always written to MongoDB. This ensures the reconciliation report can surface data quality problems explicitly rather than silently losing rows.

### Report entries embed snapshots, not references

Each `ReportEntry` embeds a denormalised snapshot of both the user and exchange sides. This trades some storage for query simplicity — the report can be served without joining back to the transactions collection, which matters for large runs.

### Matching is one-to-one

Once an exchange transaction is matched to a user transaction, it is removed from the candidate pool. This prevents a single exchange transaction being claimed by two user transactions. In ambiguous cases (tie scores) the first match wins and the second user transaction becomes unmatched, surfacing the ambiguity for human review.

### TRANSFER_IN / TRANSFER_OUT perspective flip

The same physical transfer appears as `TRANSFER_OUT` on the user side (they sent it) and `TRANSFER_IN` on the exchange side (the exchange received it). The `typesAreCompatible` utility handles this mapping explicitly rather than treating both as identical strings.

### Asset alias resolution

A static alias table maps full names (e.g. `bitcoin`, `ethereum`) to canonical tickers (`BTC`, `ETH`). This is applied at ingestion time so the matching engine only ever compares canonical uppercase symbols. The table is easy to extend without touching matching logic.

### Conflicting vs Unmatched

A **conflicting** entry means a plausible candidate was found (same asset, type-compatible, within the time window) but at least one numeric tolerance was exceeded. This is different from **unmatched**, where no candidate even exists. The distinction matters operationally: conflicts are likely data entry errors or exchange rounding; unmatched rows may be missing transactions.

---

## Data Quality Handling

The following issues are detected and logged at ingestion time:

| Issue | Field | Handling |
|---|---|---|
| Missing timestamp | `timestamp` | `isValid=false`, flagged |
| Malformed/truncated timestamp | `timestamp` | `isValid=false`, flagged |
| Missing or non-numeric quantity | `quantity` | `isValid=false`, flagged |
| Negative quantity | `quantity` | `isValid=false`, flagged |
| Missing or unrecognised type | `type` | `isValid=false`, flagged |
| Missing asset | `asset` | `isValid=false`, flagged |
| Full asset name (e.g. bitcoin) | `asset` | Normalised to ticker, no flag |
| Duplicate transaction_id within file | `transaction_id` | `isValid=false`, flagged |
| Missing price_usd (valid for transfers) | `price_usd` | Accepted, no flag |
| Non-numeric price_usd | `price_usd` | Issue logged, row still valid |

Invalid rows are excluded from matching but appear in the `invalidUser` / `invalidExchange` summary counts. They can be inspected directly in the `transactions` collection.

---

## Matching Algorithm

**Phase 1 — Candidate generation (O(n) per user transaction)**

For each valid user transaction, find exchange transactions where:
- `normalisedAsset` matches exactly
- `normalisedTimestamp` is within ± `timestampToleranceSeconds`
- The exchange transaction hasn't already been matched

**Phase 2 — Scoring and selection**

Each candidate is scored on a 0–1 scale:
- `timeScore = 1 - (timeDelta / tolerance)` (0 if outside window)
- `qtyScore = 1 - (qtyDeltaPct / tolerancePct)` (0 if outside tolerance)
- `score = (timeScore + qtyScore) / 2`

The highest-scoring type-compatible candidate is selected. If its fields are all within tolerance → **matched**. If any field exceeds tolerance → **conflicting**.

Exchange transactions with no matching user transaction → **unmatched_exchange**.

---

## Running Tests

```bash
npm test                # run all tests
npm run test:coverage   # run with coverage report
```

The test suite covers:
- Asset and type normalisation utilities
- CSV parsing with all edge cases (malformed timestamps, negative quantities, duplicates, aliases)
- Matching engine (exact match, perspective flip, tolerance breach, double-match prevention)
- All REST API endpoints (success, error, pagination, CSV export)
