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
    const samples = timeline([...repeat(1, 2, 4), ...flip, ...repeat(2, 2.4, 4), ...flip, ...repeat(3, 1.8, 4)]);
    const { chosen } = selectBestFrames(samples, { step: STEP });
    expect(chosen).toHaveLength(3);
    chosen.forEach((i) => expect(samples[i].sharpness).toBeGreaterThan(1.5));
  });

  it('picks the sharpest frame inside a view, not the first', () => {
    const samples = timeline([[1, 1.2], [1, 1.6], [1, 3.0], [1, 1.5], [1, 1.1]]);
    expect(selectBestFrames(samples, { step: STEP }).chosen).toEqual([2]);
  });

  it('drops a lone, barely-sharp frame (the tail of a page turn)', () => {
    const samples = timeline([...repeat(1, 2, 4), ...flip, [2, 0.5], ...flip, ...repeat(3, 2, 4)]);
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
    expect(views).toHaveLength(1); // one view (and so one main frame plus backups), not two
    expect(chosen.length).toBeLessThanOrEqual(3);
  });

  it('does not re-join views separated by a longer blur', () => {
    const samples = timeline([...repeat(1, 2, 5), [1, 0.1], [1, 0.1], ...repeat(1, 1.9, 5)]);
    expect(selectBestFrames(samples, { step: STEP }).views).toHaveLength(2);
  });

  it('gives longer views more candidates, spread out in time, and short views just one', () => {
    const view = (n: number) => timeline(repeat(1, 2, n).map(([p, s], i): [number, number] => [p, i === 2 ? 3 : s - 0.5]));
    const long = view(16); // 3.2 s
    const picks = selectBestFrames(long, { step: STEP }).chosen;
    expect(picks).toHaveLength(3);
    const at = picks.map((i) => long[i].timestamp).sort((a, b) => a - b);
    expect(at[1] - at[0]).toBeGreaterThanOrEqual(0.8);
    expect(at[2] - at[1]).toBeGreaterThanOrEqual(0.8);
    expect(selectBestFrames(view(7), { step: STEP }).chosen).toHaveLength(2);
    expect(selectBestFrames(view(4), { step: STEP }).chosen).toHaveLength(1);
  });

  it('gives one frame per view when backups are switched off', () => {
    const samples = timeline(repeat(1, 2, 16));
    expect(selectBestFrames(samples, { step: STEP, maxBackups: 0 }).chosen).toHaveLength(1);
    expect(selectBestFrames(samples, { step: STEP, maxBackups: 1 }).chosen).toHaveLength(2);
  });

  it('keeps the sharpest frame as the main pick even when backups exist', () => {
    const samples = timeline(repeat(1, 2, 12).map(([p, s], i): [number, number] => [p, i === 8 ? 3.2 : s]));
    const { chosen } = selectBestFrames(samples, { step: STEP });
    expect(chosen).toContain(8);
  });

  it('drops backups before any page\'s main frame when over the cap', () => {
    const frames: Array<[number, number]> = [];
    for (let p = 1; p <= 4; p += 1) frames.push(...repeat(p, 2 + p * 0.1, 12), ...flip);
    const samples = timeline(frames);
    const all = selectBestFrames(samples, { step: STEP }).chosen;
    expect(all.length).toBe(12); // 4 pages x 3 candidates
    const capped = selectBestFrames(samples, { step: STEP, maxFrames: 4 }).chosen;
    expect(capped).toHaveLength(4);
    // One frame from each of the four pages (each page spans 12 samples + 3 flip samples).
    const pageOf = (i: number) => Math.floor(i / 15);
    expect(new Set(capped.map(pageOf)).size).toBe(4);
  });

  it('skips a view that is a near-identical repeat of an earlier pick', () => {
    const samples = timeline([...repeat(1, 2, 4), ...flip, ...repeat(1, 1.8, 4)]);
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
