import { describe, expect, it } from "vitest";
import type { AnalyzedPage } from "./analysis";
import { CancelledError } from "./gemini-call";
import { planParts, readInParts } from "./reconstruct";

const page = (text: string, frames: number[], extra: Partial<AnalyzedPage> = {}): AnalyzedPage => ({
  pageNumber: 1, title: "T", text, confidence: 0.9, needsReview: false, reviewReason: null,
  sourceFrameIndices: frames, bestFrameIndex: frames[0], pageBox: null, blocks: [], ...extra,
});
const words = (seed: string) => Array.from({ length: 14 }, (_, i) => `${seed}${i}`).join(" ");

describe("planParts", () => {
  it("sends a normal capture in one request", () => {
    expect(planParts(9)).toEqual([{ from: 0, to: 9 }]);
    expect(planParts(20)).toEqual([{ from: 0, to: 20 }]);
  });

  it("splits a large capture into overlapping parts that cover every frame", () => {
    const parts = planParts(30);
    expect(parts).toEqual([{ from: 0, to: 12 }, { from: 10, to: 22 }, { from: 20, to: 30 }]);
    for (let i = 1; i < parts.length; i += 1) expect(parts[i].from).toBe(parts[i - 1].to - 2);
  });

  it("folds a tiny last part into the previous one", () => {
    expect(planParts(23)).toEqual([{ from: 0, to: 12 }, { from: 10, to: 23 }]);
  });
});

describe("readInParts", () => {
  it("moves frame numbers to the whole capture and merges the page repeated at a boundary", async () => {
    const result = await readInParts(planParts(30), async (part, index) => ({
      // Each part sees its own pages; the boundary page appears at the end of one part and the
      // start of the next.
      pages: index === 0
        ? [page(words("a"), [0, 1]), page(words("b"), [10, 11])]
        : index === 1
          ? [page(words("b"), [0, 1]), page(words("c"), [10, 11])]
          : [page(words("c"), [0]), page(words("d"), [5])],
      extra: part,
    }));
    expect(result.pages.map((p) => [p.pageNumber, p.text.slice(0, 2), p.sourceFrameIndices])).toEqual([
      [1, "a0", [0, 1]],
      [2, "b0", [10, 11]],
      [3, "c0", [20, 21]],
      [4, "d0", [25]],
    ]);
    expect(result.failedParts).toBe(0);
  });

  it("turns a failed part into one flagged placeholder page and keeps the rest", async () => {
    const result = await readInParts(planParts(30), async (part, index) => {
      if (index === 1) throw new Error("busy");
      return { pages: [page(words(`p${index}`), [1])], extra: null };
    });
    expect(result.failedParts).toBe(1);
    expect(result.pages).toHaveLength(3);
    expect(result.pages[1]).toMatchObject({ needsReview: true, sourceFrameIndices: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21], bestFrameIndex: 16 });
  });

  it("throws when every part fails, and stops at once when cancelled", async () => {
    await expect(readInParts(planParts(9), async () => { throw new Error("busy"); })).rejects.toThrow("busy");
    let calls = 0;
    await expect(readInParts(planParts(30), async () => { calls += 1; throw new CancelledError(); })).rejects.toBeInstanceOf(CancelledError);
    expect(calls).toBe(1);
  });
});
