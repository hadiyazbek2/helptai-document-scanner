import { alignedDifference, clarityFromSharpness, type Gray } from './frame-metrics';

export type Sample = {
  timestamp: number;
  sharpness: number;
  // Small normalized grayscale copy used for the "same view" and "nothing moved" checks.
  signature: Gray;
  // Share of the page's outline covered by a hand (0..1), from frame-hand.ts. Missing means unknown.
  hand?: number;
  // Share of the picture that is visible paper (0..1), from frame-hand.ts. A hand over the page
  // hides paper, so a frame with clearly less paper than its neighbours has something on it.
  paperShare?: number;
};

export type SelectOptions = {
  // Seconds between samples.
  step: number;
  maxFrames?: number;
  // Two views split by a single blurry frame are merged when their frames are this alike.
  mergeBelow?: number;
  // A frame this alike to an earlier pick from a different view is a repeat.
  repeatBelow?: number;
  // Inside a view, take one frame per this many seconds (Infinity: just the best frame per view).
  slotSeconds?: number;
  // A frame this alike to the previous pick of its view, and close in time, shows nothing new.
  staticBelow?: number;
  // Hand cover at or above which a frame counts as "hand on the page"; a pick that has it is
  // dropped when another pick within two slots has less than `handClean`.
  handLimit?: number;
  handClean?: number;
  // How far either side (seconds) a frame is compared with when judging how much paper is hidden.
  coverWindow?: number;
};

export type Selection = {
  // Indices into `samples`, in time order.
  chosen: number[];
  // Each group of clear frames that showed one view.
  views: number[][];
  minSharpness: number;
  // For every sample: how much of the page something covers (0..1), as used for choosing.
  cover: number[];
};

function percentile(values: number[], q: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

// Chooses the frames to send from a scroll or page-flip video, combining four signals:
//  1. sharpness: blurry frames (page turns, motion) are dropped;
//  2. timing: clear frames are split into "views" wherever a blurry frame interrupts them, because
//     how a frame *looks* (pixel similarity) cannot tell two text pages apart, but a flip leaves blur;
//  3. time slots: videos without blurry gaps (graph paper stays sharp through a page flip) would
//     become one giant view, so each view also gets about one frame per `slotSeconds`;
//  4. hand: within a slot the frame with the clearest, least-covered page wins, and a pick with a
//     hand on it is dropped when a clean pick is close by. A hand counts when it is on the page
//     (not beside it, not in the blank margin) and covers something.
// Splitting too much only costs an extra frame (the AI merges frames of one page); merging two pages
// would lose one, so the rules lean towards sending more frames.
export function selectBestFrames(samples: Sample[], options: SelectOptions): Selection {
  const {
    step,
    maxFrames = 45,
    mergeBelow = 0.12,
    repeatBelow = 0.06,
    slotSeconds = 1.2,
    staticBelow = 0.045,
    handLimit = 0.08,
    handClean = 0.05,
    coverWindow = 2,
  } = options;
  if (!samples.length) return { chosen: [], views: [], minSharpness: 0, cover: [] };

  // How much of the page something (a hand) covers, from two signals that fail in different ways:
  //  - hand pixels inside the page's outline (misses a hand over the page's edge, where the covered
  //    part is no longer inside the visible outline), and
  //  - how much less paper is visible than in the best nearby frame (catches those; half of the
  //    hidden share counts, since lighting and tilt also change the paper area a little).
  const cover = samples.map((sample, i) => {
    const nearby = samples
      .filter((other) => other.paperShare !== undefined && Math.abs(other.timestamp - sample.timestamp) <= coverWindow)
      .map((other) => other.paperShare as number)
      .sort((a, b) => a - b);
    const reference = nearby[Math.floor(nearby.length * 0.9)] ?? 0;
    const hidden = sample.paperShare !== undefined && reference > 0 ? Math.max(0, 1 - sample.paperShare / reference) : 0;
    return Math.max(sample.hand ?? 0, 0.5 * hidden);
  });
  const handOf = (i: number) => cover[i];
  // How good a frame is as a picture of its page: clear, and not covered by a hand.
  const quality = (i: number) => clarityFromSharpness(samples[i].sharpness) - 3 * handOf(i);
  const byQuality = (a: number, b: number) => quality(b) - quality(a) || a - b;
  const bySharpness = (a: number, b: number) => samples[b].sharpness - samples[a].sharpness || a - b;

  const allSharp = samples.map((s) => s.sharpness);
  const minSharpness = Math.max(0.15, Math.min(0.45, 0.3 * percentile(allSharp, 0.9)));
  let good = samples.map((_, i) => i).filter((i) => samples[i].sharpness >= minSharpness);
  if (!good.length) {
    // A uniformly blurry video: still return its best few frames rather than nothing.
    good = samples
      .map((_, i) => i)
      .sort(bySharpness)
      .slice(0, 3)
      .sort((a, b) => a - b);
  }

  // Split wherever at least one sample was dropped in between.
  const views: number[][] = [];
  for (const index of good) {
    const last = views[views.length - 1];
    const previous = last?.[last.length - 1];
    if (last && previous !== undefined && samples[index].timestamp - samples[previous].timestamp <= step * 1.5) {
      last.push(index);
    } else {
      views.push([index]);
    }
  }

  // Re-join views separated by exactly one dropped sample when they look nearly the same.
  const merged: number[][] = [];
  for (const view of views) {
    const last = merged[merged.length - 1];
    if (last) {
      const before = samples[last[last.length - 1]];
      const after = samples[view[0]];
      const oneSampleGap = after.timestamp - before.timestamp <= step * 2.5;
      if (oneSampleGap && alignedDifference(before.signature, after.signature) < mergeBelow) {
        last.push(...view);
        continue;
      }
    }
    merged.push([...view]);
  }

  // A view must be properly clear to be kept. A lone, barely-sharp frame is usually the tail of a
  // page turn, so it needs to be very sharp to count when it is the only frame in its view.
  const keepGate = Math.max(minSharpness * 1.3, Math.min(0.7, 0.45 * percentile(allSharp, 0.9)));
  const clearEnough = (i: number) => samples[i].sharpness >= keepGate;

  // rank 0 is a view's main frame; rank 1 are the extra frames taken every `slotSeconds`.
  const picks: Array<{ index: number; view: number; rank: number }> = [];
  for (const [viewIndex, view] of merged.entries()) {
    const sharpest = samples[[...view].sort(bySharpness)[0]].sharpness;
    if (sharpest < keepGate || (view.length < 2 && sharpest < 1.5)) continue;

    const usable = view.filter(clearEnough);
    const main = [...usable].sort(byQuality)[0];
    const mine: Array<{ index: number; rank: number }> = [{ index: main, rank: 0 }];

    if (Number.isFinite(slotSeconds)) {
      const start = samples[view[0]].timestamp;
      const end = samples[view[view.length - 1]].timestamp;
      for (let from = start; from <= end + 1e-6; from += slotSeconds) {
        const inSlot = usable.filter((i) => samples[i].timestamp >= from - 1e-6 && samples[i].timestamp < from + slotSeconds - 1e-6);
        if (!inSlot.length || inSlot.includes(main)) continue;
        mine.push({ index: [...inSlot].sort(byQuality)[0], rank: 1 });
      }
    }

    // Nothing new since the previous pick (the page was held still): skip the extra frame.
    mine.sort((a, b) => a.index - b.index);
    let previous: number | undefined;
    for (const pick of mine) {
      const still =
        previous !== undefined &&
        pick.rank > 0 &&
        samples[pick.index].timestamp - samples[previous].timestamp <= slotSeconds * 3 &&
        alignedDifference(samples[pick.index].signature, samples[previous].signature) < staticBelow;
      if (still) continue;
      picks.push({ index: pick.index, view: viewIndex, rank: pick.rank });
      previous = pick.index;
    }
  }

  // Nothing cleared the bar (a uniformly blurry video): fall back to its sharpest frames, at least
  // a second apart, rather than returning nothing.
  if (!picks.length) {
    for (const index of [...samples.keys()].sort(bySharpness)) {
      if (picks.length >= 3) break;
      if (picks.every((pick) => Math.abs(samples[pick.index].timestamp - samples[index].timestamp) >= 1)) {
        picks.push({ index, view: -1 - picks.length, rank: 0 });
      }
    }
  }

  // Drop an extra frame with a hand on it when a clean pick is close by: a cleaner frame of the
  // page already exists. A view's main frame is never dropped here, since it may be the only one.
  const cleanTimes = picks.filter((pick) => handOf(pick.index) < handClean).map((pick) => samples[pick.index].timestamp);
  const withoutHands = picks.filter((pick) => {
    if (pick.rank === 0 || handOf(pick.index) < handLimit) return true;
    const t = samples[pick.index].timestamp;
    return !cleanTimes.some((clean) => Math.abs(clean - t) <= 2 * (Number.isFinite(slotSeconds) ? slotSeconds : 1.2));
  });

  // Skip a pick that repeats one from a different view, keeping the better copy.
  const kept: typeof picks = [];
  for (const pick of [...withoutHands].sort((a, b) => byQuality(a.index, b.index))) {
    const repeat = kept.some(
      (other) =>
        other.view !== pick.view &&
        alignedDifference(samples[pick.index].signature, samples[other.index].signature) < repeatBelow,
    );
    if (!repeat) kept.push(pick);
  }

  // Over the cap: drop extra frames before any view's main frame.
  let chosen = kept.map((pick) => pick.index);
  if (chosen.length > maxFrames) {
    const rankOf = new Map(kept.map((pick) => [pick.index, pick.rank]));
    chosen = chosen.sort((a, b) => (rankOf.get(a) ?? 0) - (rankOf.get(b) ?? 0) || byQuality(a, b)).slice(0, maxFrames);
  }
  return { chosen: chosen.sort((a, b) => a - b), views: merged, minSharpness, cover };
}
