import { describe, expect, it } from 'vitest';
import { detectHand, type RgbImage } from './frame-hand';

type Colour = [number, number, number];
const TABLE: Colour = [150, 100, 60]; // warm brown wood
const SKIN: Colour = [205, 135, 105];
const WHITE: Colour = [225, 225, 225];
const BLUE: Colour = [190, 205, 235]; // graph paper
const WARM_PAPER: Colour = [222, 215, 200];

function scene(
  paper: Colour,
  options: { width?: number; height?: number; page?: [number, number, number, number]; hand?: [number, number, number, number]; tilt?: boolean } = {},
): RgbImage {
  const { width = 120, height = 214, page = [14, 12, 106, 200], hand, tilt } = options;
  const data = new Uint8ClampedArray(width * height * 4);
  const paint = (x: number, y: number, c: Colour) => {
    const p = (y * width + x) * 4;
    data[p] = c[0];
    data[p + 1] = c[1];
    data[p + 2] = c[2];
    data[p + 3] = 255;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // Light texture on the table so it is not perfectly flat.
      const jitter = ((x * 7 + y * 13) % 9) - 4;
      paint(x, y, [TABLE[0] + jitter, TABLE[1] + jitter, TABLE[2] + jitter]);
    }
  }
  const [x0, y0, x1, y1] = page;
  for (let y = y0; y < y1; y += 1) {
    // A tilted page: its left and right edges lean as we go down.
    const lean = tilt ? Math.round((y - y0) * 0.12) : 0;
    for (let x = x0 + lean; x < x1 + lean && x < width; x += 1) {
      const ink = (x % 6 === 0 || y % 9 === 0) && x > x0 + 4;
      paint(x, y, ink ? [60, 60, 70] : paper);
    }
  }
  if (hand) {
    const [hx0, hy0, hx1, hy1] = hand;
    for (let y = hy0; y < hy1; y += 1) for (let x = hx0; x < hx1; x += 1) paint(x, y, SKIN);
  }
  return { data, width, height };
}

describe('detectHand', () => {
  it('reads (almost) zero on a clean page, whatever the paper colour', () => {
    for (const paper of [WHITE, BLUE, WARM_PAPER]) {
      const result = detectHand(scene(paper));
      expect(result.fraction).toBeLessThan(0.02);
      expect(result.page).not.toBeNull();
    }
  });

  it('is not fooled by a warm table around the page', () => {
    expect(detectHand(scene(WHITE, { page: [40, 40, 80, 170] })).fraction).toBeLessThan(0.02);
  });

  it('finds a hand lying on the page, and more hand gives a bigger number', () => {
    const small = detectHand(scene(WHITE, { hand: [40, 150, 70, 180] })).fraction;
    const large = detectHand(scene(WHITE, { hand: [30, 90, 90, 190] })).fraction;
    expect(small).toBeGreaterThan(0.05);
    expect(large).toBeGreaterThan(small);
  });

  it('finds a hand on blue graph paper and on warm paper', () => {
    expect(detectHand(scene(BLUE, { hand: [30, 100, 90, 190] })).fraction).toBeGreaterThan(0.1);
    expect(detectHand(scene(WARM_PAPER, { hand: [30, 100, 90, 190] })).fraction).toBeGreaterThan(0.1);
  });

  it('does not count table in the corners of a tilted page', () => {
    expect(detectHand(scene(WHITE, { tilt: true })).fraction).toBeLessThan(0.03);
  });

  it('returns nothing when there is no page in view', () => {
    const result = detectHand(scene(TABLE, { page: [0, 0, 0, 0] }));
    expect(result.fraction).toBe(0);
    expect(result.page).toBeNull();
  });

  it('ignores a hand beside the page or in its blank margin, since it covers nothing', () => {
    const page: [number, number, number, number] = [30, 30, 90, 190];
    expect(detectHand(scene(WHITE, { page, hand: [92, 100, 118, 140] })).fraction).toBeLessThan(0.02); // beside the page
    expect(detectHand(scene(WHITE, { page, hand: [30, 100, 34, 140] })).fraction).toBeLessThan(0.02); // on the very edge
  });

  it('can return the mask of hand pixels', () => {
    const result = detectHand(scene(WHITE, { hand: [30, 100, 90, 190] }), { mask: true });
    expect(result.mask).toBeDefined();
    expect(result.mask!.reduce((a, b) => a + b, 0)).toBeGreaterThan(500);
  });
});
