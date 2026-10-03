import { describe, expect, it } from 'vitest';
import { blockLines, blockRect, fitText, pageSpace } from './layout';

describe('pageSpace', () => {
  const imageSize = { width: 480, height: 850 };
  it('uses the whole image when there is no page region', () => {
    const space = pageSpace({ pageBox: null, imageSize });
    expect(space.region).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(space.aspect).toBeCloseTo(850 / 480);
  });
  it('uses a plausible page region and measures its real aspect ratio', () => {
    const space = pageSpace({ pageBox: [100, 100, 900, 900], imageSize });
    expect(space.region).toMatchObject({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 });
    expect(space.aspect).toBeCloseTo(850 / 480);
  });
  it('ignores a region too small to be the page', () => {
    expect(pageSpace({ pageBox: [400, 400, 500, 500], imageSize }).region.width).toBe(1);
  });
});

describe('blockRect', () => {
  const space = pageSpace({ pageBox: [100, 100, 900, 900], imageSize: { width: 500, height: 500 } });
  it('maps a block into page coordinates', () => {
    const rect = blockRect([100, 100, 500, 500], space)!;
    expect(rect.x).toBeCloseTo(0);
    expect(rect.y).toBeCloseTo(0);
    expect(rect.width).toBeCloseTo(0.5);
    expect(rect.height).toBeCloseTo(0.5);
  });
  it('clamps blocks that stick out of the page and drops ones outside it', () => {
    expect(blockRect([0, 0, 300, 300], space)).toMatchObject({ x: 0, y: 0 });
    expect(blockRect([0, 0, 90, 90], space)).toBeNull();
    expect(blockRect(null, space)).toBeNull();
  });
});

describe('blockLines', () => {
  it('bullets list items, joins table cells and keeps line breaks', () => {
    expect(blockLines({ type: 'list', text: '', items: ['a', 'b'], box: null })).toEqual(['• a', '• b']);
    expect(blockLines({ type: 'table', text: '', rows: [['x', 'y']], box: null })).toEqual(['x    y']);
    expect(blockLines({ type: 'lines', text: 'one\ntwo', box: null })).toEqual(['one', 'two']);
  });
});

describe('fitText', () => {
  it('shrinks the font until wrapped text fits its box', () => {
    const text = ['The quick brown fox jumps over the lazy dog. '.repeat(6)];
    const big = fitText(text, 400, 400);
    const small = fitText(text, 400, 60);
    expect(small.fontSize).toBeLessThan(big.fontSize);
    expect(small.lines.length * small.fontSize * 1.28).toBeLessThanOrEqual(60 + 0.01);
  });
  it('never exceeds the requested maximum size', () => {
    expect(fitText(['hi'], 1000, 1000, 20).fontSize).toBeLessThanOrEqual(20);
  });
  it('keeps explicit line breaks as separate lines', () => {
    expect(fitText(['one', 'two'], 500, 500, 20).lines).toEqual(['one', 'two']);
  });
  it('spreads unwrapped lines over a tall box only when asked', () => {
    const lines = ['one', 'two', 'three'];
    const spread = fitText(lines, 800, 600, 20, true);
    const plain = fitText(lines, 800, 600, 20, false);
    expect(spread.lineHeight).toBeGreaterThan(plain.lineHeight);
    expect(spread.lineHeight * spread.fontSize * 3).toBeLessThanOrEqual(600 + 0.01);
    expect(spread.lineHeight).toBeLessThanOrEqual(2);
  });
});
