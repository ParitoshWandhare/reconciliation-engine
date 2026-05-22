"use strict";

jest.mock("../db/connection", () => ({
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../db/models/ReconciliationRun");
jest.mock("../db/models/ReportEntry");
jest.mock("../ingestion/ingestor");
jest.mock("../matching/matcher");
jest.mock("../reporting/reporter");

const request = require("supertest");
const { createApp } = require("../api/app");
const ReconciliationRun = require("../db/models/ReconciliationRun");
const ReportEntry = require("../db/models/ReportEntry");
const { ingestAll } = require("../ingestion/ingestor");
const { matchTransactions } = require("../matching/matcher");
const { persistReport, generateCsvReport } = require("../reporting/reporter");

const app = createApp();

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});

describe("POST /reconcile", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ReconciliationRun.create.mockResolvedValue({
      runId: "test-run-id",
      status: "pending",
    });
    ReconciliationRun.updateOne.mockResolvedValue({});
    ingestAll.mockResolvedValue({
      user: { total: 25, valid: 23, invalid: 2 },
      exchange: { total: 25, valid: 25, invalid: 0 },
    });
    matchTransactions.mockResolvedValue([]);
    persistReport.mockResolvedValue({
      matched: 0,
      conflicting: 0,
      unmatchedUser: 0,
      unmatchedExchange: 0,
    });
  });

  it("returns 202 with a runId", async () => {
    const res = await request(app).post("/reconcile").send({});
    expect(res.status).toBe(202);
    expect(res.body).toHaveProperty("runId");
    expect(res.body.status).toBe("pending");
  });

  it("accepts custom tolerance overrides", async () => {
    const res = await request(app).post("/reconcile").send({
      timestampToleranceSeconds: 60,
      quantityTolerancePct: 0.05,
    });
    expect(res.status).toBe(202);
    expect(res.body.config.timestampToleranceSeconds).toBe(60);
    expect(res.body.config.quantityTolerancePct).toBe(0.05);
  });

  it("rejects negative timestampToleranceSeconds", async () => {
    const res = await request(app).post("/reconcile").send({
      timestampToleranceSeconds: -10,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/timestampToleranceSeconds/);
  });

  it("rejects negative quantityTolerancePct", async () => {
    const res = await request(app).post("/reconcile").send({
      quantityTolerancePct: -0.5,
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /report/:runId/summary", () => {
  it("returns 404 for unknown runId", async () => {
    ReconciliationRun.findOne.mockReturnValue({ lean: () => Promise.resolve(null) });
    const res = await request(app).get("/report/nonexistent/summary");
    expect(res.status).toBe(404);
  });

  it("returns summary for a known run", async () => {
    ReconciliationRun.findOne.mockReturnValue({
      lean: () =>
        Promise.resolve({
          runId: "run-abc",
          status: "complete",
          config: { timestampToleranceSeconds: 300, quantityTolerancePct: 0.01 },
          summary: {
            matched: 20,
            conflicting: 1,
            unmatchedUser: 2,
            unmatchedExchange: 2,
          },
          createdAt: new Date(),
          completedAt: new Date(),
        }),
    });

    const res = await request(app).get("/report/run-abc/summary");
    expect(res.status).toBe(200);
    expect(res.body.summary.matched).toBe(20);
    expect(res.body.status).toBe("complete");
  });
});

describe("GET /report/:runId", () => {
  const mockRun = {
    runId: "run-xyz",
    status: "complete",
    config: { timestampToleranceSeconds: 300, quantityTolerancePct: 0.01 },
    summary: {},
  };

  beforeEach(() => {
    ReconciliationRun.findOne.mockReturnValue({ lean: () => Promise.resolve(mockRun) });
    ReportEntry.find.mockReturnValue({
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    });
    ReportEntry.countDocuments.mockResolvedValue(0);
  });

  it("returns paginated entries", async () => {
    const res = await request(app).get("/report/run-xyz");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("pagination");
    expect(res.body.entries).toBeInstanceOf(Array);
  });

  it("serves CSV when ?format=csv", async () => {
    generateCsvReport.mockResolvedValue("col1,col2\nval1,val2");
    const res = await request(app).get("/report/run-xyz?format=csv");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
  });
});

describe("GET /report/:runId/unmatched", () => {
  it("returns unmatched entries", async () => {
    ReconciliationRun.findOne.mockReturnValue({
      lean: () =>
        Promise.resolve({
          runId: "run-u",
          status: "complete",
          config: {},
          summary: {},
        }),
    });
    ReportEntry.find.mockReturnValue({
      lean: () =>
        Promise.resolve([
          {
            category: "unmatched_user",
            reason: "No exchange match",
            userSide: { transactionId: "USR-099" },
            exchangeSide: null,
          },
        ]),
    });

    const res = await request(app).get("/report/run-u/unmatched");
    expect(res.status).toBe(200);
    expect(res.body.unmatched).toHaveLength(1);
    expect(res.body.unmatched[0].category).toBe("unmatched_user");
  });
});
