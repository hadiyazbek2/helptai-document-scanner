import { describe, expect, it } from 'vitest';
import { buildDoc } from './doc-model';

const frame = (dataUrl: string) => ({ dataUrl, width: 400, height: 600 });
const frames = [frame('f0'), frame('f1'), frame('f2'), frame('f3')];
const apiPage = (extra = {}) => ({
  pageNumber: 1,
  title: 'T',
  text: 'x',
  confidence: 0.9,
  needsReview: false,
  reviewReason: null,
  sourceFrameIndices: [0],
  bestFrameIndex: 0,
  pageBox: null,
  blocks: [],
  ...extra,
});
const result = (pages: ReturnType<typeof apiPage>[]) => ({
  documentName: 'd',
  pages,
  selectedFrameCount: frames.length,
  discardedFrameCount: 0,
  processingNote: '',
});

describe('buildDoc', () => {
  it('uses the best frame for each page even when pages merge several frames', () => {
    // 4 frames -> 2 pages. The old code paired page 2 with frame 2 ("f1"); the true best is f3.
    const doc = buildDoc('d', result([
      apiPage({ sourceFrameIndices: [0, 1], bestFrameIndex: 1 }),
      apiPage({ pageNumber: 2, sourceFrameIndices: [2, 3], bestFrameIndex: 3 }),
    ]), frames);
    expect(doc.pages.map((p) => p.image)).toEqual(['f1', 'f3']);
  });

  it('maps needsReview to status and keeps the reason', () => {
    const doc = buildDoc('d', result([apiPage({ needsReview: true, reviewReason: 'Hand in view' })]), frames);
    expect(doc.pages[0]).toMatchObject({ status: 'needs-review', reviewReason: 'Hand in view' });
  });

  it('clamps an out-of-range frame index', () => {
    const doc = buildDoc('d', result([apiPage({ bestFrameIndex: 99 })]), frames);
    expect(doc.pages[0].image).toBe('f3');
  });

  it('keeps blocks and the page region, and records the image size', () => {
    const blocks = [{ type: 'heading' as const, level: 1, text: 'H', box: [0, 0, 100, 500] as [number, number, number, number] }];
    const doc = buildDoc('d', result([apiPage({ blocks, pageBox: [10, 10, 990, 990], bestFrameIndex: 2 })]), frames);
    expect(doc.pages[0]).toMatchObject({ blocks, pageBox: [10, 10, 990, 990], imageSize: { width: 400, height: 600 }, image: 'f2' });
  });

  it('falls back to the plain text as one paragraph when there are no blocks', () => {
    const doc = buildDoc('d', result([apiPage({ text: '  hello there ' })]), frames);
    expect(doc.pages[0].blocks).toEqual([{ type: 'paragraph', text: 'hello there', box: null }]);
  });
});
