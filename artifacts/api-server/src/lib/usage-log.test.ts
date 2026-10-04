import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { USAGE_COLUMNS, appendUsage, csvCell, usageLogPath, usageRowToCsv, type UsageRow } from "./usage-log";

const row = (extra: Partial<UsageRow> = {}): UsageRow => ({
  timestamp: "2026-10-04T10:00:00.000Z", endpoint: "process-document", requestId: "abc123", attempt: 0, document: "My notes",
  model: "gemini-3.6-flash", keyIndex: 0, outcome: "ok", finishReason: "STOP", httpStatus: 200, latencyMs: 36000, frames: 12,
  uploadKb: 854, inputTokens: 14117, outputTokens: 6076, thinkingTokens: 1445, totalTokens: 21638, note: "", ...extra,
});

describe("usage log", () => {
  it("escapes commas, quotes and newlines", () => {
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("a\nb")).toBe('"a\nb"');
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell(undefined)).toBe("");
  });

  it("writes one value per column, in order", () => {
    expect(usageRowToCsv(row()).split(",")).toHaveLength(USAGE_COLUMNS.length);
    expect(usageRowToCsv(row({ document: "a, b" }))).toContain('"a, b"');
  });

  it("creates the file with a header once, then appends rows", () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "usage-")), "nested", "usage.csv");
    expect(appendUsage(row(), file)).toBe(true);
    expect(appendUsage(row({ attempt: 1, outcome: "error", httpStatus: 503 }), file)).toBe(true);
    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(USAGE_COLUMNS.join(","));
    expect(lines[2]).toContain(",error,");
  });

  it("does not throw when the file cannot be written", () => {
    // A path whose "folder" is really a file cannot be created.
    const dir = mkdtempSync(path.join(tmpdir(), "usage-"));
    writeFileSync(path.join(dir, "blocker"), "x");
    expect(appendUsage(row(), path.join(dir, "blocker", "usage.csv"))).toBe(false);
  });

  it("defaults to data/usage.csv two levels up, and can be overridden", () => {
    expect(usageLogPath({} as NodeJS.ProcessEnv).endsWith(path.join("data", "usage.csv"))).toBe(true);
    expect(usageLogPath({ USAGE_LOG_FILE: "/x/y.csv" } as NodeJS.ProcessEnv)).toBe("/x/y.csv");
  });
});
