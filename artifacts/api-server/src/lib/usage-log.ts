import { appendFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";

// One row per Gemini call (including failed attempts), so token use and cost can be tracked.
export type UsageRow = {
  timestamp: string;
  endpoint: string;
  requestId: string;
  attempt: number;
  document: string;
  model: string;
  keyIndex: number;
  outcome: "ok" | "blocked" | "error";
  finishReason: string;
  httpStatus: number | "";
  latencyMs: number;
  frames: number;
  uploadKb: number;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  totalTokens: number;
  note: string;
};

export const USAGE_COLUMNS: Array<keyof UsageRow> = [
  "timestamp", "endpoint", "requestId", "attempt", "document", "model", "keyIndex", "outcome", "finishReason",
  "httpStatus", "latencyMs", "frames", "uploadKb", "inputTokens", "outputTokens", "thinkingTokens", "totalTokens", "note",
];

export function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const usageRowToCsv = (row: UsageRow) => USAGE_COLUMNS.map((column) => csvCell(row[column])).join(",");

export function usageLogPath(env: NodeJS.ProcessEnv = process.env) {
  // The server runs from artifacts/api-server, so the project's data folder is two levels up.
  return env.USAGE_LOG_FILE ?? path.resolve(process.cwd(), "..", "..", "data", "usage.csv");
}

// Appends one row, creating the file (with a header) if needed. Never throws: losing a log line
// must not break a request.
export function appendUsage(row: UsageRow, file = usageLogPath()): boolean {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    const isNew = !existsSync(file) || statSync(file).size === 0;
    appendFileSync(file, `${isNew ? `${USAGE_COLUMNS.join(",")}\n` : ""}${usageRowToCsv(row)}\n`);
    return true;
  } catch {
    return false;
  }
}
