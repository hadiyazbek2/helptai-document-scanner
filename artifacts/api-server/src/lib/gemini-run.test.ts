import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPagePrompt, buildPrompt, mainPage } from "./analysis";
import { resetModelCooldowns } from "./gemini-call";
import { analyzeWith, buildParts, type GenerateFn } from "./gemini-run";

const frames = [{ timestamp: 0, sharpness: 1, difference: 0 }];
const goodText = JSON.stringify({
  pages: [{ title: "T", confidence: 0.9, needsReview: false, sourceFrames: [1], bestFrame: 1, blocks: [{ type: "paragraph", text: "hello" }] }],
});
const err = (status: number, message: string) => Object.assign(new Error(message), { status });
const dailyQuota = () => err(429, "Quota exceeded GenerateRequestsPerDayPerProjectPerModel-FreeTier");

beforeEach(() => resetModelCooldowns());

describe("analyzeWith", () => {
  it("returns pages, the model used and token usage", async () => {
    const generate: GenerateFn = async () => ({
      text: goodText,
      usage: { inputTokens: 1200, outputTokens: 300, thinkingTokens: 50 },
    });
    const out = await analyzeWith(generate, frames, { models: ["m"], keyCount: 1 });
    expect(out.pages).toHaveLength(1);
    expect(out.usage).toEqual({ model: "m", inputTokens: 1200, outputTokens: 300, thinkingTokens: 50 });
  });

  it("moves to the next API key when the first is out of daily quota", async () => {
    const calls: Array<[string, number]> = [];
    const generate: GenerateFn = async ({ model, keyIndex }) => {
      calls.push([model, keyIndex]);
      if (keyIndex === 0) throw dailyQuota();
      return { text: goodText };
    };
    const out = await analyzeWith(generate, frames, { models: ["best", "weaker"], keyCount: 2 });
    expect(out.model).toBe("best");
    expect(calls).toEqual([["best", 0], ["best", 1]]); // second key, same preferred model
  });

  it("only drops to a weaker model after every key is out for the better one", async () => {
    const calls: string[] = [];
    const generate: GenerateFn = async ({ model, keyIndex }) => {
      calls.push(`${model}@${keyIndex}`);
      if (model === "best") throw dailyQuota();
      return { text: goodText };
    };
    const out = await analyzeWith(generate, frames, { models: ["best", "weaker"], keyCount: 2 });
    expect(out.model).toBe("weaker");
    expect(calls).toEqual(["best@0", "best@1", "weaker@0"]);
  });

  it("treats a RECITATION stop as a refusal and tries the next target", async () => {
    const generate = vi.fn<GenerateFn>(async ({ model }) =>
      model === "a" ? { text: "", finishReason: "RECITATION" } : { text: goodText },
    );
    const out = await analyzeWith(generate, frames, { models: ["a", "b"], keyCount: 1 });
    expect(out.model).toBe("b");
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("reports zero usage when the response has none", async () => {
    const out = await analyzeWith(async () => ({ text: goodText }), frames, { models: ["m"], keyCount: 1 });
    expect(out.usage).toMatchObject({ inputTokens: 0, outputTokens: 0, thinkingTokens: 0 });
  });
});

describe("page prompts", () => {
  it("asks for exactly one page built from Frame 1", () => {
    const prompt = buildPagePrompt("My notes", 3);
    expect(prompt).toContain("page 3");
    expect(prompt).toContain('"My notes"');
    expect(prompt).toContain("sourceFrames: [1]");
    expect(prompt).toContain("bestFrame: 1");
    expect(prompt).toContain("blocks:");
  });
  it("keeps the whole-document prompt unchanged in what it asks for", () => {
    const prompt = buildPrompt("Doc", [{ timestamp: 1, sharpness: 0.9, difference: 0 }]);
    expect(prompt).toContain("sourceFrames: the frame numbers");
    expect(prompt).toContain("fill in any text it hides");
    expect(prompt).toContain("Frame 1: 1.00s");
  });
  it("keeps the page with the most text when a retake returns several", () => {
    const page = (text: string) => ({ text }) as Parameters<typeof mainPage>[0][number];
    expect(mainPage([page("a"), page("longer text"), page("mid")]).text).toBe("longer text");
  });
});

describe("buildParts", () => {
  it("puts each image's label immediately before that image", () => {
    const parts = buildParts("instructions", [
      { mimeType: "image/jpeg", data: "AAA", label: "Frame 1 (0.0s):" },
      { mimeType: "image/jpeg", data: "BBB", label: "Frame 2 (1.2s):" },
    ]);
    expect(parts).toEqual([
      { text: "instructions" },
      { text: "Frame 1 (0.0s):" },
      { inlineData: { mimeType: "image/jpeg", data: "AAA" } },
      { text: "Frame 2 (1.2s):" },
      { inlineData: { mimeType: "image/jpeg", data: "BBB" } },
    ]);
  });
  it("works without labels", () => {
    expect(buildParts("x", [{ mimeType: "image/png", data: "Z" }])).toHaveLength(2);
  });
});
