import type { ProcessDocumentResult } from '@helptai/api-client-react';

export type PageStatus = 'ok' | 'needs-review' | 'patched';

// The single source of truth for a page: review, patch, saving and export all read this.
export type Page = {
  id: string;
  pageNumber: number;
  title: string;
  text: string;
  confidence: number;
  status: PageStatus;
  reviewReason: string | null;
  image: string;
  sourceFrameIndices: number[];
  bestFrameIndex: number;
};

export type Doc = {
  name: string;
  pages: Page[];
  selectedFrameCount: number;
  discardedFrameCount: number;
  processingNote: string;
};

// Builds pages from the API result. The image for each page is the frame Gemini judged
// clearest for that page, not a guess based on page order.
export function buildDoc(
  name: string,
  result: ProcessDocumentResult,
  frames: ReadonlyArray<{ dataUrl: string }>,
): Doc {
  const pages = result.pages.map((page, index): Page => {
    const bestFrameIndex = Math.min(Math.max(0, page.bestFrameIndex), frames.length - 1);
    return {
      id: `page-${index + 1}`,
      pageNumber: index + 1,
      title: page.title,
      text: page.text,
      confidence: page.confidence,
      status: page.needsReview ? 'needs-review' : 'ok',
      reviewReason: page.reviewReason,
      image: frames[bestFrameIndex].dataUrl,
      sourceFrameIndices: page.sourceFrameIndices,
      bestFrameIndex,
    };
  });
  return {
    name,
    pages,
    selectedFrameCount: result.selectedFrameCount,
    discardedFrameCount: result.discardedFrameCount,
    processingNote: result.processingNote,
  };
}
