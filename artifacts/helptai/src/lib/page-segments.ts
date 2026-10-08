import { clarityFromSharpness } from './frame-metrics';

// Splits a page-flip or scroll video into page views ("segments") and picks the clearest frame of
// each, from per-moment measurements. Pure, so it can be tested and tuned without a browser.
//
// How a page change shows up in the measurements:
//  - blur: a flip on plain paper smears the text, so sharpness drops far below the video's best;
//  - motion: graph paper stays sharp while it flips, but the picture changes a lot from one moment
//    to the next. Motion is judged against the video's own typical motion, since a hand-held phone
//    always wobbles a little and how much depends on the person and the paper.
// What does NOT work (measured on the test videos): comparing how two frames look. Two handwritten
// pages differ about as much as two views of one page taken a second apart, so segments are never
// merged on looks alone, only when the break between them was too short to be a flip.

export type Moment = {
  timestamp: number;
  sharpness: number;
  // How much the picture changed since the previous moment (mean absolute difference of small,
  // exposure-normalized grey copies). 0 for the first moment.
  motion: number;
  // How much of the page something (a hand) covers, 0..1. Missing means unknown.
  cover?: number;
};

export type Segment = {
  // First and last moment (indices into the moments) of the steady view.
  start: number;
  end: number;
  // The time range around it that still shows this page, including the edges of the flips on
  // either side: what the user can scrub through to choose another frame.
  from: number;
  to: number;
  // The chosen frame, and extra frames for long views (see `longView`).
  best: number;
  extras: number[];
};

export type SegmentOptions = {
  // A moment is part of a flip when its sharpness is below this share of the video's sharp level
  // (the 90th percentile)...
  blurRatio?: number;
  // ...or when its motion is above this many times the video's median motion (one jolt), or above
  // `sustainedRatio` times it for at least two moments in a row (a flip).
  motionRatio?: number;
  sustainedRatio?: number;
  // A steady view must last at least this long (seconds) to count as a page; shorter ones are the
  // settling tail of a flip.
  minView?: number;
  // Views longer than this (seconds) get an extra frame every `extraEvery` seconds: a slow scroll
  // has no flips to split on, and a missed page is worse than a repeated one (the AI merges those).
  longView?: number;
  extraEvery?: number;
  // Safety cap on the number of frames returned.
  maxFrames?: number;
};

function quantile(values: number[], q: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))] ?? 0;
}

export function findPageSegments(moments: Moment[], options: SegmentOptions = {}): Segment[] {
  const { blurRatio = 0.3, motionRatio = 4.5, sustainedRatio = 2.2, minView = 0.25, longView = 6, extraEvery = 3, maxFrames = 45 } = options;
  if (!moments.length) return [];
  const step = moments.length > 1 ? (moments[moments.length - 1].timestamp - moments[0].timestamp) / (moments.length - 1) : 0.1;

  const sharpLevel = quantile(moments.map((m) => m.sharpness), 0.9);
  const typicalMotion = Math.max(1e-3, quantile(moments.slice(1).map((m) => m.motion), 0.5));
  const blurry = (i: number) => moments[i].sharpness < blurRatio * sharpLevel;
  // A flip moves the picture for several moments in a row; a wobble is one jolt. So a moment counts
  // as moving when it is part of a sustained run above `sustainedRatio`, or one very large jolt.
  const above = (i: number, ratio: number) => i > 0 && i < moments.length && moments[i].motion > ratio * typicalMotion;
  const moving = (i: number) =>
    above(i, motionRatio) || (above(i, sustainedRatio) && (above(i - 1, sustainedRatio) || above(i + 1, sustainedRatio)));
  const steady = moments.map((_, i) => !blurry(i) && !moving(i));

  // Runs of steady moments.
  let runs: Array<[number, number]> = [];
  for (let i = 0; i < moments.length; i += 1) {
    if (!steady[i]) continue;
    const last = runs[runs.length - 1];
    if (last && last[1] === i - 1) last[1] = i;
    else runs.push([i, i]);
  }
  // One mildly unsteady moment between two runs is a wobble, not a flip (a flip takes several
  // moments, or blurs, or jolts the picture hard): join the runs.
  const mild = (i: number) => !blurry(i) && !above(i, motionRatio);
  const joined: Array<[number, number]> = [];
  for (const run of runs) {
    const last = joined[joined.length - 1];
    if (last && run[0] - last[1] === 2 && mild(last[1] + 1) && moments[run[0]].timestamp - moments[last[1]].timestamp <= 0.25) {
      last[1] = run[1];
    } else {
      joined.push([...run]);
    }
  }
  runs = joined.filter(([a, b]) => moments[b].timestamp - moments[a].timestamp + step >= minView);

  if (!runs.length) {
    // Nothing steady at all (a very shaky or blurry video): treat it as one view, so its sharpest
    // frames are still offered rather than nothing.
    runs = [[0, moments.length - 1]];
  }

  // How good a moment is as the picture of its page: clear, not covered, and not mid-motion.
  const motionPenalty = (i: number) => {
    const around = [i, i + 1].filter((k) => k < moments.length).map((k) => moments[k].motion / typicalMotion);
    return Math.max(0, Math.max(...around) - 1.5) * 0.05;
  };
  const quality = (i: number) => clarityFromSharpness(moments[i].sharpness) - 3 * (moments[i].cover ?? 0) - motionPenalty(i);
  const bestOf = (from: number, to: number) => {
    let best = from;
    for (let i = from; i <= to; i += 1) if (quality(i) > quality(best)) best = i;
    return best;
  };

  const segments: Segment[] = runs.map(([start, end], k) => {
    const best = bestOf(start, end);
    const extras: number[] = [];
    const length = moments[end].timestamp - moments[start].timestamp;
    if (length > longView) {
      // Pick the best frame of each `extraEvery` slot that does not already hold `best`.
      for (let slotStart = moments[start].timestamp; slotStart <= moments[end].timestamp; slotStart += extraEvery) {
        let from = -1;
        let to = -1;
        for (let i = start; i <= end; i += 1) {
          const t = moments[i].timestamp;
          if (t >= slotStart - 1e-6 && t < slotStart + extraEvery - 1e-6) {
            if (from < 0) from = i;
            to = i;
          }
        }
        if (from < 0 || (best >= from && best <= to)) continue;
        // Keep it well apart from the frames already chosen.
        const pick = bestOf(from, to);
        const tooClose = [best, ...extras].some((other) => Math.abs(moments[other].timestamp - moments[pick].timestamp) < extraEvery * 0.6);
        if (!tooClose) extras.push(pick);
      }
      extras.sort((a, b) => a - b);
    }
    // The scrub range reaches halfway into the flips on either side, where the page often is
    // still (or already) readable.
    const previousEnd = k > 0 ? moments[runs[k - 1][1]].timestamp : 0;
    const nextStart = k < runs.length - 1 ? moments[runs[k + 1][0]].timestamp : moments[moments.length - 1].timestamp;
    const from = (previousEnd + moments[start].timestamp) / 2;
    const to = (moments[end].timestamp + nextStart) / 2;
    return { start, end, from: k === 0 ? 0 : from, to: k === runs.length - 1 ? moments[moments.length - 1].timestamp : to, best, extras };
  });

  // Over the cap: drop extra frames first (latest-added slots go first), then the weakest views.
  let total = segments.reduce((n, s) => n + 1 + s.extras.length, 0);
  for (const segment of [...segments].sort((a, b) => b.extras.length - a.extras.length)) {
    while (total > maxFrames && segment.extras.length) {
      segment.extras.pop();
      total -= 1;
    }
  }
  if (total > maxFrames) {
    const keep = new Set(
      [...segments].sort((a, b) => quality(b.best) - quality(a.best)).slice(0, maxFrames),
    );
    return segments.filter((s) => keep.has(s));
  }
  return segments;
}

// How much of the page something (a hand) covers at each moment, from two signals that fail in
// different ways:
//  - hand pixels inside the page's outline (misses a hand over the page's edge, where the covered
//    part is no longer inside the visible outline), and
//  - how much less paper is visible than in the best nearby moment (catches those; half of the
//    hidden share counts, since lighting and tilt also change the paper area a little).
export function pageCover(
  moments: ReadonlyArray<{ timestamp: number; hand?: number; paperShare?: number }>,
  window = 2,
): number[] {
  return moments.map((moment) => {
    const nearby = moments
      .filter((other) => other.paperShare !== undefined && Math.abs(other.timestamp - moment.timestamp) <= window)
      .map((other) => other.paperShare as number)
      .sort((a, b) => a - b);
    const reference = nearby[Math.floor(nearby.length * 0.9)] ?? 0;
    const hidden = moment.paperShare !== undefined && reference > 0 ? Math.max(0, 1 - moment.paperShare / reference) : 0;
    return Math.max(moment.hand ?? 0, 0.5 * hidden);
  });
}

// Cover at or above which a frame is shown with a "hand in view" tag.
export const HAND_TAG = 0.08;
