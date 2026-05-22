"use strict";

const path = require("path");
const fs = require("fs");
const os = require("os");
const { parseCsvFile } = require("../ingestion/csvParser");

/** Write a temp CSV file and return its path */
function writeTempCsv(content) {
  const file = path.join(os.tmpdir(), `test_${Date.now()}.csv`);
  fs.writeFileSync(file, content, "utf-8");
  return file;
}

describe("parseCsvFile", () => {
  afterEach(() => {
    // temp files are cleaned up by OS eventually; no explicit cleanup needed
  });

  test("parses a clean file correctly", async () => {
    const csv = `transaction_id,timestamp,type,asset,quantity,price_usd,fee,note
TX-001,2024-03-01T09:00:00Z,BUY,BTC,0.5,62000,0.0005,test
TX-002,2024-03-01T10:00:00Z,SELL,ETH,1.0,3400,0.001,`;
    const file = writeTempCsv(csv);
    const { records, stats } = await parseCsvFile(file, "user");

    expect(stats.total).toBe(2);
    expect(stats.valid).toBe(2);
    expect(stats.invalid).toBe(0);
    expect(records[0].normalisedAsset).toBe("BTC");
    expect(records[0].normalisedType).toBe("BUY");
    expect(records[0].normalisedQuantity).toBe(0.5);
    expect(records[0].normalisedTimestamp).toBeInstanceOf(Date);
  });

  test("flags a malformed timestamp", async () => {
    const csv = `transaction_id,timestamp,type,asset,quantity,price_usd,fee,note
TX-BAD,2024-03-09T,SELL,ETH,0.3,3510,0.0003,`;
    const file = writeTempCsv(csv);
    const { records } = await parseCsvFile(file, "user");

    expect(records[0].isValid).toBe(false);
    expect(records[0].dataQualityIssues.some((i) => i.field === "timestamp")).toBe(true);
  });

  test("flags a negative quantity", async () => {
    const csv = `transaction_id,timestamp,type,asset,quantity,price_usd,fee,note
TX-NEG,2024-03-10T08:00:00Z,BUY,BTC,-0.1,62000,0.0001,`;
    const file = writeTempCsv(csv);
    const { records } = await parseCsvFile(file, "user");

    expect(records[0].isValid).toBe(false);
    expect(records[0].dataQualityIssues.some((i) => i.field === "quantity")).toBe(true);
  });

  test("flags a duplicate transaction_id", async () => {
    const csv = `transaction_id,timestamp,type,asset,quantity,price_usd,fee,note
TX-DUP,2024-03-01T09:00:00Z,BUY,BTC,0.5,62000,0.0005,first
TX-DUP,2024-03-01T09:01:00Z,BUY,BTC,0.5,62000,0.0005,second`;
    const file = writeTempCsv(csv);
    const { records } = await parseCsvFile(file, "user");

    const dup = records.find(
      (r) => r.dataQualityIssues.some((i) => i.issue.includes("duplicate"))
    );
    expect(dup).toBeDefined();
  });

  test("normalises bitcoin asset alias", async () => {
    const csv = `transaction_id,timestamp,type,asset,quantity,price_usd,fee,note
TX-ALIAS,2024-03-03T10:00:00Z,BUY,bitcoin,0.25,61800,0.00025,`;
    const file = writeTempCsv(csv);
    const { records } = await parseCsvFile(file, "user");

    expect(records[0].normalisedAsset).toBe("BTC");
    expect(records[0].isValid).toBe(true);
  });

  test("flags missing type", async () => {
    const csv = `transaction_id,timestamp,type,asset,quantity,price_usd,fee,note
TX-NOTYPE,2024-03-01T09:00:00Z,,BTC,0.5,62000,0.0005,`;
    const file = writeTempCsv(csv);
    const { records } = await parseCsvFile(file, "exchange");

    expect(records[0].isValid).toBe(false);
    expect(records[0].dataQualityIssues.some((i) => i.field === "type")).toBe(true);
  });

  test("preserves null price_usd for transfer rows", async () => {
    const csv = `transaction_id,timestamp,type,asset,quantity,price_usd,fee,note
TX-XFER,2024-03-02T14:45:00Z,TRANSFER_IN,ETH,1.0,,0.001,received`;
    const file = writeTempCsv(csv);
    const { records } = await parseCsvFile(file, "exchange");

    expect(records[0].isValid).toBe(true);
    expect(records[0].raw.price_usd).toBe("");
  });
});
