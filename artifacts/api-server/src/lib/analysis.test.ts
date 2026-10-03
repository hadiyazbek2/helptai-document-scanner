import { describe, expect, it } from "vitest";
import { InvalidOutputError } from "./gemini-call";
import { parseModelResult } from "./analysis";

const frames = [
  { timestamp: 0, sharpness: 0.4, difference: 1 },
  { timestamp: 1, sharpness: 0.9, difference: 0.5 },
  { timestamp: 2, sharpness: 0.7, difference: 0.5 },
];
const page = (extra = {}) => ({
  title: "T",
  text: " hello ",
  confidence: 0.9,
  needsReview: false,
  reviewReason: null,
  sourceFrames: [1, 2],
  bestFrame: 2,
  ...extra,
});
const parse = (pages: unknown[]) => parseModelResult(JSON.stringify({ pages }), frames);

describe("parseModelResult", () => {
  it("converts 1-based frame numbers to 0-based indices and keeps the model's best frame", () => {
    const [p] = parse([page()]);
    expect(p.sourceFrameIndices).toEqual([0, 1]);
    expect(p.bestFrameIndex).toBe(1);
    expect(p.text).toBe("hello");
  });

  it("falls back to the sharpest source frame when bestFrame is not a source", () => {
    const [p] = parse([page({ sourceFrames: [1, 2], bestFrame: 3 })]);
    expect(p.bestFrameIndex).toBe(1);
  });

  it("drops out-of-range and duplicate frame numbers", () => {
    const [p] = parse([page({ sourceFrames: [2, 2, 9, 0, -1], bestFrame: 2 })]);
    expect(p.sourceFrameIndices).toEqual([1]);
  });

  it("uses reading order when the model gives no usable frames", () => {
    const pages = parse([page({ sourceFrames: [] }), page({ sourceFrames: "x" })]);
    expect(pages.map((p) => p.sourceFrameIndices)).toEqual([[0], [1]]);
  });

  it("renumbers pages in array order", () => {
    const pages = parse([page(), page()]);
    expect(pages.map((p) => p.pageNumber)).toEqual([1, 2]);
  });

  it("flags low confidence and supplies a calm reason", () => {
    const [p] = parse([page({ confidence: 0.5 })]);
    expect(p.needsReview).toBe(true);
    expect(p.reviewReason).toMatch(/hard to read/);
  });

  it("accepts JSON wrapped in a code fence", () => {
    const fenced = "```json\n" + JSON.stringify({ pages: [page()] }) + "\n```";
    expect(parseModelResult(fenced, frames)).toHaveLength(1);
  });

  it("throws InvalidOutputError for bad or empty output", () => {
    expect(() => parseModelResult("not json", frames)).toThrow(InvalidOutputError);
    expect(() => parseModelResult('{"pages":[]}', frames)).toThrow(InvalidOutputError);
    expect(() => parseModelResult('{"nope":1}', frames)).toThrow(InvalidOutputError);
  });
});
