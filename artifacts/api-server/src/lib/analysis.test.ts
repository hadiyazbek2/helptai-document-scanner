import { describe, expect, it } from "vitest";
import { InvalidOutputError } from "./gemini-call";
import { blocksToText, normalizeBox, parseModelResult } from "./analysis";

const frames = [
  { timestamp: 0, sharpness: 0.4, difference: 1 },
  { timestamp: 1, sharpness: 0.9, difference: 0.5 },
  { timestamp: 2, sharpness: 0.7, difference: 0.5 },
];
const page = (extra = {}) => ({
  title: "T",
  blocks: [{ type: "paragraph", text: " hello ", box: [100, 100, 200, 900] }],
  confidence: 0.9,
  needsReview: false,
  reviewReason: null,
  sourceFrames: [1, 2],
  bestFrame: 2,
  ...extra,
});
const parse = (pages: unknown[]) => parseModelResult(JSON.stringify({ pages }), frames);
const blockOf = (block: unknown) => parse([page({ blocks: [block] })])[0].blocks;

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

describe("page layout (blocks)", () => {
  it("keeps block types, heading levels and boxes, and derives the page text", () => {
    const [p] = parse([
      page({
        pageBox: [10, 20, 990, 980],
        blocks: [
          { type: "heading", level: 1, text: "Title", box: [10, 10, 60, 500] },
          { type: "paragraph", text: "Body text.", box: [70, 10, 200, 900] },
          { type: "list", items: ["one", "two"], box: [210, 10, 300, 400] },
        ],
      }),
    ]);
    expect(p.pageBox).toEqual([10, 20, 990, 980]);
    expect(p.blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "list"]);
    expect(p.blocks[0]).toMatchObject({ level: 1, box: [10, 10, 60, 500] });
    expect(p.text).toBe("Title\n\nBody text.\n\n• one\n• two");
  });

  it("clamps heading levels and defaults unknown types to paragraphs", () => {
    expect(blockOf({ type: "heading", level: 9, text: "H" })[0]).toMatchObject({ level: 3 });
    expect(blockOf({ type: "heading", text: "H" })[0]).toMatchObject({ level: 2 });
    expect(blockOf({ type: "banner", text: "x" })[0].type).toBe("paragraph");
  });

  it("builds lists from items, or from text lines when items are missing", () => {
    expect(blockOf({ type: "list", items: [" a ", "", "b"] })[0].items).toEqual(["a", "b"]);
    expect(blockOf({ type: "list", text: "- one\n2. two" })[0].items).toEqual(["one", "two"]);
  });

  it("squares up table rows and keeps figures without text", () => {
    expect(blockOf({ type: "table", rows: [["a", "b", "c"], ["d"]] })[0].rows).toEqual([["a", "b", "c"], ["d", "", ""]]);
    expect(blockOf({ type: "figure", text: "a long description", box: [0, 0, 500, 500] })[0]).toEqual({ type: "figure", text: "", box: [0, 0, 500, 500] });
  });

  it("drops empty blocks but keeps the page", () => {
    const [p] = parse([page({ blocks: [{ type: "paragraph", text: "  " }, null, "x"] })]);
    expect(p.blocks).toEqual([]);
    expect(p.text).toBe("");
  });

  it("validates boxes", () => {
    expect(normalizeBox([10.4, 20, 300, 400])).toEqual([10, 20, 300, 400]);
    expect(normalizeBox([-50, 0, 2000, 1000])).toEqual([0, 0, 1000, 1000]);
    expect(normalizeBox([300, 20, 100, 400])).toBeNull(); // upside down
    expect(normalizeBox([1, 2, 3])).toBeNull();
    expect(normalizeBox(["a", 0, 10, 10])).toBeNull();
    expect(normalizeBox(null)).toBeNull();
  });

  it("converts blocks to plain text with tables as rows", () => {
    expect(blocksToText([{ type: "table", text: "", rows: [["a", "b"], ["c", "d"]], box: null }])).toBe("a | b\nc | d");
  });
});
