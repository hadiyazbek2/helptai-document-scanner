import { Type } from "@google/genai";
import type { Box, PageBlock } from "@helptai/api-zod";
import { InvalidOutputError } from "./gemini-call";

export type FrameInfo = { timestamp: number; sharpness: number; difference: number };

export type AnalyzedPage = {
  pageNumber: number;
  title: string;
  // Plain-text version of `blocks`, for search, copying and simple consumers.
  text: string;
  confidence: number;
  needsReview: boolean;
  reviewReason: string | null;
  sourceFrameIndices: number[];
  bestFrameIndex: number;
  pageBox: Box | null;
  blocks: PageBlock[];
};

const BLOCK_TYPES = ["heading", "paragraph", "list", "table", "lines", "caption", "figure", "header", "footer"] as const;
const BOX_SCHEMA = { type: Type.ARRAY, items: { type: Type.INTEGER }, nullable: true };

export const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    pages: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          confidence: { type: Type.NUMBER },
          needsReview: { type: Type.BOOLEAN },
          reviewReason: { type: Type.STRING, nullable: true },
          sourceFrames: { type: Type.ARRAY, items: { type: Type.INTEGER } },
          bestFrame: { type: Type.INTEGER },
          pageBox: BOX_SCHEMA,
          blocks: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                type: { type: Type.STRING, enum: [...BLOCK_TYPES] },
                level: { type: Type.INTEGER, nullable: true },
                text: { type: Type.STRING },
                items: { type: Type.ARRAY, items: { type: Type.STRING }, nullable: true },
                rows: {
                  type: Type.ARRAY,
                  items: { type: Type.ARRAY, items: { type: Type.STRING } },
                  nullable: true,
                },
                box: BOX_SCHEMA,
              },
              required: ["type", "text"],
            },
          },
        },
        required: ["title", "confidence", "needsReview", "sourceFrames", "bestFrame", "blocks"],
      },
    },
  },
  required: ["pages"],
};

// What to return for each page; shared by the whole-document and single-page prompts.
const PAGE_FIELDS = `- title: a short descriptive title, or "Untitled page"
- confidence: 0 to 1, based on readability and completeness
- needsReview: true when text is materially hard to read, the page is incomplete (for example a hand or a page turn covers text), or the sequence has a gap
- reviewReason: a calm, plain-language explanation when needsReview is true, otherwise null
- sourceFrames: the frame numbers (as labelled above, starting at 1) that show this page
- bestFrame: one of sourceFrames, the frame where this page is clearest and most fully visible, with no fingers or motion blur over the text
- pageBox: where the paper page is inside the bestFrame image, as [ymin, xmin, ymax, xmax], integers from 0 to 1000 (fractions of the image height and width, times 1000)
- blocks: the page's content in reading order, rebuilt so it keeps the page's own layout. Each block has:
  - type: "heading" (with level 1 to 3, 1 being the largest), "paragraph" (join wrapped lines into one flowing paragraph), "list" (each bullet or numbered item as an entry in items, without its bullet or number), "table" (rows, each a list of cell texts), "lines" (text whose line breaks matter, such as handwriting, code, formulas, poems; keep each line of the page on its own line using newlines in text), "caption" (text under a figure), "figure" (a picture or diagram: leave text empty, do not describe it), "header" or "footer" (running heads, page numbers, dates)
  - text: the block's text (for lists and tables, leave text empty and fill items or rows)
  - box: where the block is in the bestFrame image, as [ymin, xmin, ymax, xmax], integers from 0 to 1000, drawn tightly around the block (around the picture for figures)
  Keep the original wording and order. Include every readable piece of text on the page, including margin notes and labels.`;

export function buildPrompt(documentName: string, frames: FrameInfo[]) {
  const frameNotes = frames
    .map(
      (frame, index) =>
        `Frame ${index + 1}: ${frame.timestamp.toFixed(2)}s, local clarity ${frame.sharpness.toFixed(2)}`,
    )
    .join("\n");

  return `You are reconstructing a document for helptai. The user recorded one continuous scroll through a book, notebook or bound document. The images are ordered candidate frames, already filtered locally for blur and repeats. The local clarity number is only a rough hint; judge clarity yourself from the images.

Document name: ${documentName}

${frameNotes}

Inspect the images in sequence. Several frames often show the same page, and a frame can show parts of two pages while a page is being turned. Group the frames into logical pages in reading order. Do not invent content. For each page return:
${PAGE_FIELDS}

Frames that only show a page turn, a hand, or the table, with no readable page, belong to no page. Keep the page list concise: if several frames show the same page, merge them into one page.`;
}

// Prompt for rebuilding one page from a single retake photo.
export function buildPagePrompt(documentName: string, pageNumber: number) {
  return `You are rebuilding ONE page of a document for helptai. The user took a fresh, close photo of page ${pageNumber} of "${documentName}" because the first capture of it was hard to read. The image is Frame 1.

Return exactly one page, built only from this photo. If the photo shows parts of a neighbouring page, ignore them and rebuild only the page that fills most of the photo. Do not invent content. If the photo is still hard to read, say so honestly with needsReview and a calm reviewReason.

For the page return:
${PAGE_FIELDS.replace("- sourceFrames: the frame numbers (as labelled above, starting at 1) that show this page", "- sourceFrames: [1]").replace("- bestFrame: one of sourceFrames, the frame where this page is clearest and most fully visible, with no fingers or motion blur over the text", "- bestFrame: 1")}`;
}

// A retake photo should give one page; if the model returns several (a photo of a spread),
// keep the one with the most text.
export function mainPage(pages: AnalyzedPage[]): AnalyzedPage {
  return pages.reduce((best, page) => (page.text.length > best.text.length ? page : best));
}

export function parseModelResult(text: string, frames: FrameInfo[]): AnalyzedPage[] {
  let value: unknown;
  try {
    value = JSON.parse(
      text
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, ""),
    );
  } catch {
    throw new InvalidOutputError("Model output was not valid JSON");
  }
  const rawPages = (value as { pages?: unknown } | null)?.pages;
  if (!Array.isArray(rawPages)) throw new InvalidOutputError("Model output had no pages array");

  const pages = rawPages
    .map((page, index) => normalizePage(page, index, frames))
    .filter((page): page is AnalyzedPage => page !== null)
    .map((page, index) => ({ ...page, pageNumber: index + 1 }));
  if (!pages.length) throw new InvalidOutputError("Model output contained no usable pages");
  return pages;
}

export function normalizeBox(value: unknown): Box | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const numbers = value.map(Number);
  if (numbers.some((n) => !Number.isFinite(n))) return null;
  const [ymin, xmin, ymax, xmax] = numbers.map((n) => Math.max(0, Math.min(1000, Math.round(n))));
  // Must enclose a visible area.
  return ymax - ymin >= 5 && xmax - xmin >= 5 ? [ymin, xmin, ymax, xmax] : null;
}

const clean = (value: unknown) => (typeof value === "string" ? value.replace(/\r/g, "").trim() : "");

function normalizeBlock(value: unknown): PageBlock | null {
  if (!value || typeof value !== "object") return null;
  const block = value as Record<string, unknown>;
  const type = BLOCK_TYPES.find((candidate) => candidate === block.type) ?? "paragraph";
  const box = normalizeBox(block.box);
  const text = clean(block.text);

  if (type === "list") {
    const items = (Array.isArray(block.items) ? block.items : [])
      .map(clean)
      .filter(Boolean);
    // A "list" with only text: split it into items on line breaks.
    if (!items.length && text) items.push(...text.split(/\n+/).map((line) => line.replace(/^[-•*\d.)\s]+/, "").trim()).filter(Boolean));
    return items.length ? { type, text: "", items, box } : null;
  }
  if (type === "table") {
    const rows = (Array.isArray(block.rows) ? block.rows : [])
      .map((row) => (Array.isArray(row) ? row.map((cell) => clean(cell)) : []))
      .filter((row) => row.some(Boolean));
    if (rows.length) {
      const width = Math.max(...rows.map((row) => row.length));
      return { type, text: "", rows: rows.map((row) => [...row, ...Array(width - row.length).fill("")]), box };
    }
    return text ? { type: "paragraph", text, box } : null;
  }
  if (type === "figure") return { type, text: "", box };
  if (!text) return null;

  const level = Number(block.level);
  return {
    type,
    text,
    ...(type === "heading" ? { level: Number.isInteger(level) ? Math.max(1, Math.min(3, level)) : 2 } : {}),
    box,
  };
}

// The plain-text form of a page's blocks.
export function blocksToText(blocks: PageBlock[]): string {
  return blocks
    .map((block) => {
      if (block.type === "list") return (block.items ?? []).map((item) => `• ${item}`).join("\n");
      if (block.type === "table") return (block.rows ?? []).map((row) => row.join(" | ")).join("\n");
      return block.text;
    })
    .filter(Boolean)
    .join("\n\n");
}

function normalizePage(value: unknown, index: number, frames: FrameInfo[]): AnalyzedPage | null {
  if (!value || typeof value !== "object") return null;
  const page = value as Record<string, unknown>;

  const rawConfidence = Number(page.confidence);
  const confidence = Number.isFinite(rawConfidence) ? Math.max(0, Math.min(1, rawConfidence)) : 0.5;
  const needsReview = page.needsReview === true || confidence < 0.72;

  // Frame numbers from the model are 1-based; the API uses 0-based indices.
  const sourceFrameIndices = [
    ...new Set(
      (Array.isArray(page.sourceFrames) ? page.sourceFrames : [])
        .map(Number)
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= frames.length)
        .map((n) => n - 1),
    ),
  ].sort((a, b) => a - b);
  // If the model gave no usable frame numbers, fall back to reading order.
  if (!sourceFrameIndices.length) sourceFrameIndices.push(Math.min(index, frames.length - 1));

  const claimedBest = Number(page.bestFrame) - 1;
  const bestFrameIndex = sourceFrameIndices.includes(claimedBest)
    ? claimedBest
    : sourceFrameIndices.reduce((best, i) => (frames[i].sharpness > frames[best].sharpness ? i : best));

  const blocks = (Array.isArray(page.blocks) ? page.blocks : [])
    .map(normalizeBlock)
    .filter((block): block is PageBlock => block !== null);
  // Boxes refer to the best frame; if the model named a different best frame than the one it
  // measured against we cannot know, so they are used as given.
  return {
    pageNumber: index + 1,
    title: clean(page.title) || "Untitled page",
    text: blocksToText(blocks),
    confidence,
    needsReview,
    reviewReason: needsReview ? clean(page.reviewReason) || "The text was hard to read from the capture." : null,
    sourceFrameIndices,
    bestFrameIndex,
    pageBox: normalizeBox(page.pageBox),
    blocks,
  };
}
