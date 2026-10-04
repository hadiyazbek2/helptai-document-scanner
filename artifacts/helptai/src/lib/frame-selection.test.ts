import { describe, expect, it } from 'vitest';
import { normalize } from './frame-metrics';
import { selectBestFrames, type Sample } from './frame-selection';
import { textPage } from './test-images';

const STEP = 0.2;
const signatures = new Map<number, ReturnType<typeof normalize>>();
const signature = (page: number) => {
  if (!signatures.has(page)) signatures.set(page, normalize(textPage(page, 100, 178)));
  return signatures.get(page)!;
};

type Spec = [page: number, sharpness: number, hand?: number];
// Build a timeline from one spec per STEP seconds.
const timeline = (frames: Spec[]): Sample[] =>
  frames.map(([page, sharpness, hand = 0], i) => ({ timestamp: i * STEP, sharpness, signature: signature(page), hand }));
const repeat = (page: number, sharpness: number, count: number, hand = 0): Spec[] =>
  Array.from({ length: count }, (_, i) => [page, sharpness - i * 0.01, hand]);
const flip: Spec[] = [[90, 0.05], [91, 0.08], [92, 0.06]];
const every = { step: STEP, staticBelow: 0 }; // identical test frames would otherwise count as "nothing new"
const pages = (n: number, length: number, base = 2): Spec[] => {
  const out: Spec[] = [];
  for (let p = 1; p <= n; p += 1) out.push(...repeat(p, base + p * 0.1, length), ...flip);
  return out;
};

describe('page views (timing)', () => {
  it('picks a frame from every page and none of the blurry page turns', () => {
    const samples = timeline(pages(3, 4));
    const { chosen } = selectBestFrames(samples, every);
    expect(chosen).toHaveLength(3);
    chosen.forEach((i) => expect(samples[i].sharpness).toBeGreaterThan(1.5));
  });

  it('picks the sharpest frame of a view when nothing covers the page', () => {
    const samples = timeline([[1, 1.2], [1, 1.6], [1, 3.0], [1, 1.5], [1, 1.1]]);
    expect(selectBestFrames(samples, { ...every, slotSeconds: Infinity }).chosen).toEqual([2]);
  });

  it('drops a lone, barely-sharp frame (the tail of a page turn)', () => {
    const samples = timeline([...repeat(1, 2, 4), ...flip, [2, 0.5], ...flip, ...repeat(3, 2, 4)]);
    expect(selectBestFrames(samples, every).chosen).toHaveLength(2);
  });

  it('keeps two different pages apart across one blurry frame, and re-joins a page that looks the same', () => {
    expect(selectBestFrames(timeline([...repeat(1, 2, 5), [90, 0.1], ...repeat(2, 2, 5)]), every).views).toHaveLength(2);
    expect(selectBestFrames(timeline([...repeat(1, 2, 5), [1, 0.1], ...repeat(1, 1.9, 5)]), every).views).toHaveLength(1);
    expect(selectBestFrames(timeline([...repeat(1, 2, 5), [1, 0.1], [1, 0.1], ...repeat(1, 1.9, 5)]), every).views).toHaveLength(2);
  });

  it('skips a view that repeats an earlier one', () => {
    const samples = timeline([...repeat(1, 2, 4), ...flip, ...repeat(1, 1.8, 4)]);
    expect(selectBestFrames(samples, every).chosen).toHaveLength(1);
  });

  it('still returns something from a uniformly blurry video, and handles an empty one', () => {
    const blurry = timeline(Array.from({ length: 10 }, (_, i): Spec => [i, 0.1 + i * 0.001]));
    expect(selectBestFrames(blurry, every).chosen.length).toBeGreaterThan(0);
    expect(selectBestFrames([], every).chosen).toEqual([]);
  });
});

describe('time slots (videos with no blurry gaps)', () => {
  // A graph-paper video: every frame stays sharp, even during page flips, so there is one big view.
  const gridVideo = (seconds: number) => timeline(repeat(1, 3, Math.round(seconds / STEP)));

  it('takes about one frame per slot from a long view instead of just a few', () => {
    const samples = gridVideo(14);
    const { chosen, views } = selectBestFrames(samples, every);
    expect(views).toHaveLength(1);
    expect(chosen.length).toBeGreaterThanOrEqual(11); // ~14 s / 1.2 s
    expect(chosen.length).toBeLessThanOrEqual(13);
  });

  it('keeps just the best frame per view when asked for one frame per page', () => {
    expect(selectBestFrames(gridVideo(14), { ...every, slotSeconds: Infinity }).chosen).toHaveLength(1);
  });

  it('a longer slot gives fewer frames', () => {
    const samples = gridVideo(14);
    const a = selectBestFrames(samples, { ...every, slotSeconds: 1.2 }).chosen.length;
    const b = selectBestFrames(samples, { ...every, slotSeconds: 2.4 }).chosen.length;
    expect(b).toBeLessThan(a);
  });

  it('skips frames that show nothing new while the page is held still', () => {
    const samples = gridVideo(14); // identical frames: nothing changes
    const { chosen } = selectBestFrames(samples, { step: STEP }); // default staticBelow
    expect(chosen.length).toBeLessThan(selectBestFrames(samples, every).chosen.length);
    expect(chosen.length).toBeGreaterThanOrEqual(1);
  });

  it('puts the main frame of a view at its sharpest even with slots', () => {
    const samples = timeline(repeat(1, 2, 12).map(([p, s], i): Spec => [p, i === 8 ? 3.2 : s]));
    expect(selectBestFrames(samples, every).chosen).toContain(8);
  });
});

describe('hands', () => {
  it('prefers the frame without a hand over a sharper frame with one', () => {
    const samples = timeline([[1, 2.0, 0], [1, 2.1, 0], [1, 3.0, 0.2], [1, 2.2, 0.2], [1, 2.0, 0]]);
    const { chosen } = selectBestFrames(samples, { ...every, slotSeconds: Infinity });
    expect(chosen).toHaveLength(1);
    expect(samples[chosen[0]].hand).toBe(0);
  });

  it('drops an extra frame with a hand when a clean frame is nearby', () => {
    // Slot 1 clean, slot 2 only hand frames, slot 3 clean.
    const spec: Spec[] = [...repeat(1, 2, 6, 0), ...repeat(1, 2.5, 6, 0.2), ...repeat(1, 2, 6, 0)];
    const samples = timeline(spec);
    const { chosen } = selectBestFrames(samples, every);
    expect(chosen.every((i) => (samples[i].hand ?? 0) < 0.08)).toBe(true);
  });

  it('keeps the least-covered frame when every frame of a page has a hand', () => {
    const samples = timeline([[1, 2, 0.3], [1, 2, 0.12], [1, 2, 0.25], [1, 2, 0.2], [1, 2, 0.18]]);
    const { chosen } = selectBestFrames(samples, { ...every, slotSeconds: Infinity });
    expect(chosen).toEqual([1]);
  });

  it('does not drop the only frame of a page just because a hand is on it', () => {
    const samples = timeline([...repeat(1, 2, 4, 0), ...flip, ...repeat(2, 2, 4, 0.2)]);
    const { chosen } = selectBestFrames(samples, every);
    expect(chosen.some((i) => samples[i].timestamp >= 1.4)).toBe(true); // page 2 is still represented
  });
});

describe('paper hidden by a hand', () => {
  // `hand` is 0 everywhere (a hand over the page's edge is not seen inside its outline), but the
  // visible paper shrinks while the hand is there.
  const withPaper = (specs: Array<[number, number]>): Sample[] =>
    specs.map(([sharpness, paperShare], i) => ({ timestamp: i * STEP, sharpness, signature: signature(1), hand: 0, paperShare }));

  it('prefers a frame with all its paper visible over a sharper one with some hidden', () => {
    const samples = withPaper([[2.0, 0.8], [2.1, 0.8], [3.0, 0.5], [2.2, 0.52], [2.0, 0.8]]);
    const { chosen } = selectBestFrames(samples, { ...every, slotSeconds: Infinity });
    expect(chosen).toHaveLength(1);
    expect(samples[chosen[0]].paperShare).toBe(0.8);
  });

  it('reports how much is covered for every frame', () => {
    const samples = withPaper([[2, 0.8], [2, 0.8], [2, 0.4]]);
    const { cover } = selectBestFrames(samples, every);
    expect(cover).toHaveLength(3);
    expect(cover[0]).toBeLessThan(0.02);
    expect(cover[2]).toBeGreaterThan(0.2); // half of the ~50% hidden
  });

  it('only compares with frames close in time, so a different page far away is not a reference', () => {
    const spec: Array<[number, number]> = [...Array(15).fill([2, 0.5]), ...Array(15).fill([2, 0.9])];
    const { cover } = selectBestFrames(withPaper(spec), every);
    expect(cover[2]).toBeLessThan(0.05); // 0.5 is normal for the first page; the later 0.9 is 3 s away
  });
});

describe('frame budget', () => {
  it('drops extra frames before any page main frame when over the cap', () => {
    const samples = timeline(pages(4, 12));
    expect(selectBestFrames(samples, every).chosen.length).toBeGreaterThan(4);
    const capped = selectBestFrames(samples, { ...every, maxFrames: 4 }).chosen;
    expect(capped).toHaveLength(4);
    const pageOf = (i: number) => Math.floor(i / 15); // each page spans 12 samples + 3 flip samples
    expect(new Set(capped.map(pageOf)).size).toBe(4);
  });
});
