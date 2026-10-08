import { describe, expect, it } from 'vitest';
import { findPageSegments, pageCover, type Moment } from './page-segments';

const STEP = 0.1;
// One spec per STEP seconds: [sharpness, motion since the previous moment, cover].
type Spec = [sharpness: number, motion: number, cover?: number];
const timeline = (specs: Spec[]): Moment[] =>
  specs.map(([sharpness, motion, cover = 0], i) => ({ timestamp: +(i * STEP).toFixed(2), sharpness, motion: i ? motion : 0, cover }));
const still = (count: number, sharpness = 2, cover = 0): Spec[] => Array.from({ length: count }, (_, i) => [sharpness - i * 0.001, 0.1, cover]);
// A flip on plain paper: the text smears.
const blurFlip: Spec[] = [[0.3, 0.3], [0.05, 0.6], [0.05, 0.6], [0.4, 0.3]];
// A flip on graph paper: everything stays sharp, but the picture changes a lot for a few moments.
const sharpFlip: Spec[] = [[2, 0.8], [2, 0.9], [2, 0.7]];
const bestTimes = (moments: Moment[]) => findPageSegments(moments).map((s) => moments[s.best].timestamp);

describe('findPageSegments', () => {
  it('finds one view per page across blurry flips, never picking a flip frame', () => {
    const moments = timeline([...still(12), ...blurFlip, ...still(12), ...blurFlip, ...still(12)]);
    const segments = findPageSegments(moments);
    expect(segments).toHaveLength(3);
    segments.forEach((s) => expect(moments[s.best].sharpness).toBeGreaterThan(1.5));
  });

  it('finds flips on graph paper from motion alone, when nothing gets blurry', () => {
    expect(findPageSegments(timeline([...still(12), ...sharpFlip, ...still(12), ...sharpFlip, ...still(12)]))).toHaveLength(3);
  });

  it('treats a single jolt as a wobble, not a page change', () => {
    expect(findPageSegments(timeline([...still(12), [2, 0.35], ...still(12)]))).toHaveLength(1);
  });

  it('a very large single jolt still splits', () => {
    expect(findPageSegments(timeline([...still(12), [2, 0.9], [2, 0.1], [2, 0.9], ...still(12)]))).toHaveLength(2);
  });

  it('drops a view too short to be a page (the settling tail of a flip)', () => {
    expect(findPageSegments(timeline([...still(12), ...blurFlip, [2, 0.1], ...blurFlip, ...still(12)]))).toHaveLength(2);
  });

  it('picks the sharpest frame when nothing covers the page', () => {
    const moments = timeline([[1.2, 0.1], [1.6, 0.1], [3, 0.1], [1.5, 0.1], [1.1, 0.1]]);
    expect(bestTimes(moments)).toEqual([0.2]);
  });

  it('prefers a slightly softer frame with no hand over a sharp one with a hand', () => {
    const moments = timeline([...still(5, 2.5, 0.2), ...still(5, 1.8, 0)]);
    const [segment] = findPageSegments(moments);
    expect(moments[segment.best].cover).toBe(0);
  });

  it('adds extra frames to a long view without flips (a slow scroll), but not to short ones', () => {
    const long = findPageSegments(timeline(still(100)));
    expect(long).toHaveLength(1);
    expect(long[0].extras.length).toBeGreaterThanOrEqual(2);
    expect(findPageSegments(timeline(still(50)))[0].extras).toEqual([]);
  });

  it('gives each view a scrub range that covers its own moments and reaches into the flips', () => {
    const moments = timeline([...still(12), ...blurFlip, ...still(12)]);
    const [first, second] = findPageSegments(moments);
    expect(first.from).toBe(0);
    expect(first.to).toBeGreaterThan(moments[first.end].timestamp);
    expect(second.from).toBeLessThan(moments[second.start].timestamp);
    expect(second.to).toBe(moments[moments.length - 1].timestamp);
    expect(first.to).toBeLessThanOrEqual(second.from + 1e-9);
  });

  it('still offers something from a uniformly blurry or shaky video, and handles an empty one', () => {
    expect(findPageSegments(timeline(Array.from({ length: 20 }, (_, i): Spec => [0.05, i % 2 ? 0.9 : 0.1])))).toHaveLength(1);
    expect(findPageSegments([])).toEqual([]);
  });

  it('respects the frame cap, dropping extra frames first', () => {
    const pages: Spec[] = [];
    for (let p = 0; p < 6; p += 1) pages.push(...still(80), ...blurFlip);
    const moments = timeline(pages);
    const total = (cap: number) => findPageSegments(moments, { maxFrames: cap }).reduce((n, s) => n + 1 + s.extras.length, 0);
    expect(total(45)).toBeGreaterThan(6);
    expect(total(6)).toBe(6);
    expect(findPageSegments(moments, { maxFrames: 6 })).toHaveLength(6);
    expect(total(4)).toBe(4);
  });
});

describe('pageCover', () => {
  it('is the hand on the page, or half the paper hidden compared with nearby moments', () => {
    const cover = pageCover([
      { timestamp: 0, hand: 0, paperShare: 0.6 },
      { timestamp: 0.1, hand: 0.02, paperShare: 0.6 },
      { timestamp: 0.2, hand: 0.01, paperShare: 0.3 },
      { timestamp: 0.3, hand: 0.12, paperShare: 0.6 },
    ]);
    expect(cover[0]).toBe(0);
    expect(cover[1]).toBeCloseTo(0.02);
    expect(cover[2]).toBeCloseTo(0.25);
    expect(cover[3]).toBeCloseTo(0.12);
  });
});
