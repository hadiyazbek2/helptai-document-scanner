import { describe, expect, it } from "vitest";
import { collectApiKeys } from "./keys";

describe("collectApiKeys", () => {
  it("reads GEMINI_API_KEY first, then any other GEMINI_API_KEY* variable by name", () => {
    expect(collectApiKeys({ GEMINI_API_KEYv1: "b", GEMINI_API_KEY: "a", GEMINI_API_KEY_2: "c", OTHER: "x" })).toEqual(["a", "c", "b"]);
  });
  it("also reads a comma-separated GEMINI_API_KEYS list", () => {
    expect(collectApiKeys({ GEMINI_API_KEY: "a", GEMINI_API_KEYS: "b, c" })).toEqual(["a", "b", "c"]);
  });
  it("drops blanks and duplicates, and strips quotes", () => {
    expect(collectApiKeys({ GEMINI_API_KEY: '"a"', GEMINI_API_KEYv1: "a", GEMINI_API_KEY_3: "  " })).toEqual(["a"]);
  });
  it("returns nothing when there is no key", () => {
    expect(collectApiKeys({})).toEqual([]);
  });
});
