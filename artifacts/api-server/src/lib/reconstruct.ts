import { mergeRepeatedPages, type AnalyzedPage } from "./analysis";
import { CancelledError } from "./gemini-call";

// A run of consecutive frames sent to Gemini in one request: indices [from, to).
export type Part = { from: number; to: number };

export type PartOptions = {
  // Up to this many frames go in one request. On the free tier every request counts against a
  // small daily limit, and with thinking set to "low" an 8-page answer uses about a quarter of the
  // output limit, so one request is preferred whenever it fits.
  maxSingle?: number;
  // Larger captures are split into parts of this many frames...
  size?: number;
  // ...that share this many frames with the previous part, so a page on the boundary is seen
  // whole in at least one part. The repeat is merged afterwards by its text.
  overlap?: number;
};

export function planParts(count: number, { maxSingle = 20, size = 12, overlap = 2 }: PartOptions = {}): Part[] {
  if (count <= maxSingle) return [{ from: 0, to: count }];
  const parts: Part[] = [];
  const stride = Math.max(1, size - overlap);
  for (let from = 0; from < count; from += stride) {
    const to = Math.min(count, from + size);
    parts.push({ from, to });
    if (to === count) break;
  }
  // A tiny last part (only overlap frames and one or two more) is folded into the previous one.
  const last = parts[parts.length - 1];
  const previous = parts[parts.length - 2];
  if (previous && last.to - last.from <= overlap + 2) {
    previous.to = last.to;
    parts.pop();
  }
  return parts;
}

export type PartResult<Extra> = { pages: AnalyzedPage[]; extra: Extra };

// Reads each part in turn (one after another, to stay inside per-minute limits) and joins their
// pages into one document. Page frame numbers come back relative to their part and are moved to
// the whole capture's numbering. A part that fails becomes one flagged placeholder page covering
// its frames, so the rest of the document is not lost and the user can fix that stretch with the
// frame picker or a retake. If every part fails, the first error is thrown.
export async function readInParts<Extra>(
  parts: Part[],
  readPart: (part: Part, index: number) => Promise<PartResult<Extra>>,
): Promise<{ pages: AnalyzedPage[]; extras: Extra[]; failedParts: number }> {
  const collected: AnalyzedPage[] = [];
  const extras: Extra[] = [];
  let firstError: unknown = null;
  let failedParts = 0;

  for (const [index, part] of parts.entries()) {
    try {
      const { pages, extra } = await readPart(part, index);
      extras.push(extra);
      const shift = (i: number) => Math.min(part.to - 1, part.from + i);
      collected.push(
        ...pages.map((page) => ({
          ...page,
          sourceFrameIndices: page.sourceFrameIndices.map(shift),
          bestFrameIndex: shift(page.bestFrameIndex),
        })),
      );
    } catch (error) {
      if (error instanceof CancelledError) throw error;
      firstError ??= error;
      failedParts += 1;
      collected.push(placeholderPage(part));
    }
  }
  if (failedParts === parts.length) throw firstError;

  const pages = mergeRepeatedPages(collected).map((page, index) => ({ ...page, pageNumber: index + 1 }));
  return { pages, extras, failedParts };
}

function placeholderPage(part: Part): AnalyzedPage {
  const frames = Array.from({ length: part.to - part.from }, (_, i) => part.from + i);
  return {
    pageNumber: 0,
    title: "Pages that could not be read",
    text: "",
    confidence: 0,
    needsReview: true,
    reviewReason: `Gemini could not read this part of the capture (frames ${part.from + 1} to ${part.to}). Choose another frame from the video, or retake these pages with a photo.`,
    sourceFrameIndices: frames,
    bestFrameIndex: frames[Math.floor(frames.length / 2)],
    pageBox: null,
    blocks: [],
  };
}
