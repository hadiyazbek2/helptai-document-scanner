import { Type } from "@google/genai";
import { InvalidOutputError } from "./gemini-call";

export type FrameInfo = { timestamp: number; sharpness: number; difference: number };

export type AnalyzedPage = {
  pageNumber: number;
  title: string;
  text: string;
  confidence: number;
  needsReview: boolean;
  reviewReason: string | null;
  sourceFrameIndices: number[];
  bestFrameIndex: number;
};

export const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    pages: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          text: { type: Type.STRING },
          confidence: { type: Type.NUMBER },
          needsReview: { type: Type.BOOLEAN },
          reviewReason: { type: Type.STRING, nullable: true },
          sourceFrames: { type: Type.ARRAY, items: { type: Type.INTEGER } },
          bestFrame: { type: Type.INTEGER },
        },
        required: ["title", "text", "confidence", "needsReview", "sourceFrames", "bestFrame"],
      },
    },
  },
  required: ["pages"],
};

export function buildPrompt(documentName: string, frames: FrameInfo[]) {
  const frameNotes = frames
    .map(
      (frame, index) =>
        `Frame ${index + 1}: ${frame.timestamp.toFixed(2)}s, local sharpness ${frame.sharpness.toFixed(2)}`,
    )
    .join("\n");

  return `You are reconstructing a document for helptai. The user recorded one continuous scroll through a book or bound document. The images are ordered candidate frames, already filtered locally for repeats. Local sharpness numbers are only a rough hint; judge clarity yourself from the images.

Document name: ${documentName}

${frameNotes}

Inspect the images in sequence. Several frames often show the same page, and a frame can show parts of two pages while a page is being turned. Group the frames into logical pages in reading order. Do not invent content. For each page, return:
- title: a short descriptive title, or "Untitled page"
- text: the readable text of that page, merging what is visible across its frames, preserving paragraphs
- confidence: 0 to 1, based on readability and completeness
- needsReview: true when text is materially hard to read, the page is incomplete (for example a hand or a page turn covers text), or the sequence has a gap
- reviewReason: a calm, plain-language explanation when needsReview is true, otherwise null
- sourceFrames: the frame numbers (as labelled above, starting at 1) that show this page
- bestFrame: one of sourceFrames, the frame where this page is clearest and most fully visible, with no fingers or motion blur over the text

Frames that only show a page turn, a hand, or the table, with no readable page, belong to no page. Keep the page list concise: if several frames show the same page, merge them into one page.`;
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

  return {
    pageNumber: index + 1,
    title:
      typeof page.title === "string" && page.title.trim() ? page.title.trim() : "Untitled page",
    text: typeof page.text === "string" ? page.text.trim() : "",
    confidence,
    needsReview,
    reviewReason: needsReview
      ? typeof page.reviewReason === "string" && page.reviewReason.trim()
        ? page.reviewReason.trim()
        : "The text was hard to read from the capture."
      : null,
    sourceFrameIndices,
    bestFrameIndex,
  };
}
