import type { Box, PageBlock, ProcessDocumentResult, ReconstructedPage } from '@helptai/api-client-react';

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
  imageSize: { width: number; height: number };
  // The page rebuilt as structured pieces in reading order, with where each sat on the page.
  blocks: PageBlock[];
  // Where the paper page is inside `image`, if known.
  pageBox: Box | null;
  sourceFrameIndices: number[];
  bestFrameIndex: number;
  // The stretch of the capture video that shows this page, and the moment the image was taken from
  // (null when the image is a separate photo). Lets the user choose another frame for the page.
  video: { from: number; to: number; at: number | null } | null;
  // How many times this page has been replaced with a retake photo.
  retakes: number;
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
  frames: ReadonlyArray<{ dataUrl: string; width: number; height: number; timestamp?: number; range?: { from: number; to: number } }>,
): Doc {
  const pages = result.pages.map((page, index): Page => {
    const bestFrameIndex = Math.min(Math.max(0, page.bestFrameIndex), frames.length - 1);
    const frame = frames[bestFrameIndex];
    // Older or partial results may have no blocks: show the text as one paragraph instead.
    const blocks: PageBlock[] = page.blocks?.length
      ? page.blocks
      : page.text.trim()
        ? [{ type: 'paragraph', text: page.text.trim(), box: null }]
        : [];
    const ranges = page.sourceFrameIndices.map((i) => frames[i]?.range).filter((range) => range !== undefined);
    if (frame.range) ranges.push(frame.range);
    const video = ranges.length
      ? { from: Math.min(...ranges.map((r) => r.from)), to: Math.max(...ranges.map((r) => r.to)), at: frame.timestamp ?? null }
      : null;
    return {
      id: `page-${index + 1}`,
      pageNumber: index + 1,
      title: page.title,
      text: page.text,
      confidence: page.confidence,
      status: page.needsReview ? 'needs-review' : 'ok',
      reviewReason: page.reviewReason,
      image: frame.dataUrl,
      imageSize: { width: frame.width, height: frame.height },
      blocks,
      pageBox: page.pageBox ?? null,
      sourceFrameIndices: page.sourceFrameIndices,
      bestFrameIndex,
      video,
      retakes: 0,
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

// Replaces one page with the result of a retake photo, or of another frame the user chose from the
// video (`videoAt` is that frame's time). Everything about the page comes from the new image
// (image, text, layout, confidence). It counts as fixed ("patched") only when the new
// read is good; otherwise it stays flagged, with the new reason, so the user can try again.
export function applyPatch(
  doc: Doc,
  pageNumber: number,
  result: ReconstructedPage,
  image: { dataUrl: string; width: number; height: number },
  videoAt: number | null = null,
): Doc {
  const pages = doc.pages.map((page): Page => {
    if (page.pageNumber !== pageNumber) return page;
    const blocks: PageBlock[] = result.blocks?.length
      ? result.blocks
      : result.text.trim()
        ? [{ type: 'paragraph', text: result.text.trim(), box: null }]
        : [];
    const stillPoor = result.needsReview || !blocks.length;
    return {
      ...page,
      // Keep the earlier title when the new read could not find one.
      title: /^untitled page$/i.test(result.title.trim()) ? page.title : result.title,
      text: result.text,
      confidence: result.confidence,
      status: stillPoor ? 'needs-review' : 'patched',
      reviewReason: stillPoor ? result.reviewReason ?? 'The text is still a little hard to read in this photo.' : null,
      image: image.dataUrl,
      imageSize: { width: image.width, height: image.height },
      blocks,
      pageBox: result.pageBox ?? null,
      sourceFrameIndices: [],
      bestFrameIndex: 0,
      video: page.video ? { ...page.video, at: videoAt } : null,
      retakes: page.retakes + 1,
    };
  });
  return { ...doc, pages };
}
