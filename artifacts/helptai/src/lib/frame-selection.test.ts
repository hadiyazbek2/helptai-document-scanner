import { describe, expect, it } from 'vitest';
import { normalize } from './frame-metrics';
import { textPage } from './test-images';
import { selectBestFrames, type Sample } from './frame-selection';

const STEP = 0.2;
const signatures = new Map<number, ReturnType<typeof normalize>>();
const signature = (page: number) => {
  if (!signatures.has(page)) signatures.set(page, normalize(textPage(page, 100, 178)));
  return signatures.get(page)!;
};

// Build a timeline from [page, sharpness] pairs, one per STEP seconds.
const timeline = (frames: Array<[number, number]>): Sample[] =>
  frames.map(([page, sharpness], i) => ({ timestamp: i * STEP, sharpness, signature: signature(page) }));
const times = (samples: Sample[], chosen: number[]) => chosen.map((i) => samples[i].timestamp);
const repeat = (page: number, sharpness: number, count: number): Array<[number, number]> =>
  Array.from({ length: count }, (_, i) => [page, sharpness - i * 0.01]);
const flip: Array<[number, number]> = [[90, 0.05], [91, 0.08], [92, 0.06]];

describe('selectBestFrames', () => {
  it('picks one sharp frame per page and none of the blurry page turns', () => {
    const samples = timeline([...repeat(1, 2, 6), ...flip, ...repeat(2, 2.4, 6), ...flip, ...repeat(3, 1.8, 6)]);
    const { chosen } = selectBestFrames(samples, { step: STEP });
    expect(chosen).toHaveLength(3);
    chosen.forEach((i) => expect(samples[i].sharpness).toBeGreaterThan(1.5));
  });

  it('picks the sharpest frame inside a view, not the first', () => {
    const samples = timeline([[1, 1.2], [1, 1.6], [1, 3.0], [1, 1.5], [1, 1.1]]);
    expect(selectBestFrames(samples, { step: STEP }).chosen).toEqual([2]);
  });

  it('drops a lone, barely-sharp frame (the tail of a page turn)', () => {
    const samples = timeline([...repeat(1, 2, 6), ...flip, [2, 0.5], ...flip, ...repeat(3, 2, 6)]);
    const { chosen } = selectBestFrames(samples, { step: STEP });
    expect(chosen).toHaveLength(2);
  });

  it('keeps two different pages apart even when they look alike across one blurry frame', () => {
    const samples = timeline([...repeat(1, 2, 5), [90, 0.1], ...repeat(2, 2, 5)]);
    expect(selectBestFrames(samples, { step: STEP }).views).toHaveLength(2);
  });

  it('re-joins a view split by a single blurry frame when it looks the same', () => {
    const samples = timeline([...repeat(1, 2, 5), [1, 0.1], ...repeat(1, 1.9, 5)]);
    const { views, chosen } = selectBestFrames(samples, { step: STEP });
    expect(views).toHaveLength(1);
    expect(chosen).toHaveLength(1);
  });

  it('does not re-join views separated by a longer blur', () => {
    const samples = timeline([...repeat(1, 2, 5), [1, 0.1], [1, 0.1], ...repeat(1, 1.9, 5)]);
    expect(selectBestFrames(samples, { step: STEP }).views).toHaveLength(2);
  });

  it('adds a well-separated backup frame for long views only', () => {
    const long = timeline(repeat(1, 2, 16).map(([p, s], i): [number, number] => [p, i === 2 ? 3 : i === 12 ? 2.5 : s - 0.5]));
    const { chosen } = selectBestFrames(long, { step: STEP });
    expect(times(long, chosen).length).toBe(2);
    expect(Math.abs(long[chosen[0]].timestamp - long[chosen[1]].timestamp)).toBeGreaterThanOrEqual(1);
    expect(selectBestFrames(timeline(repeat(1, 2, 6)), { step: STEP }).chosen).toHaveLength(1);
  });

  it('skips a view that is a near-identical repeat of an earlier pick', () => {
    const samples = timeline([...repeat(1, 2, 5), ...flip, ...repeat(1, 1.8, 5)]);
    expect(selectBestFrames(samples, { step: STEP }).chosen).toHaveLength(1);
  });

  it('still returns something from a uniformly blurry video', () => {
    const samples = timeline(Array.from({ length: 10 }, (_, i): [number, number] => [i, 0.1 + i * 0.001]));
    expect(selectBestFrames(samples, { step: STEP }).chosen.length).toBeGreaterThan(0);
  });

  it('respects the maximum number of frames, keeping the sharpest', () => {
    const pages: Array<[number, number]> = [];
    for (let p = 1; p <= 6; p += 1) pages.push(...repeat(p, 1.5 + p * 0.1, 4), ...flip);
    const samples = timeline(pages);
    const { chosen } = selectBestFrames(samples, { step: STEP, maxFrames: 3 });
    expect(chosen).toHaveLength(3);
    chosen.forEach((i) => expect(samples[i].sharpness).toBeGreaterThan(1.85));
  });

  it('handles an empty video', () => {
    expect(selectBestFrames([], { step: STEP }).chosen).toEqual([]);
  });
});
