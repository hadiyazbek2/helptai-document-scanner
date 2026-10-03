import { alignedDifference, type Gray } from './frame-metrics';

export type Sample = {
  timestamp: number;
  sharpness: number;
  // Small normalized grayscale copy used only for the "same view across one blurry frame" check.
  signature: Gray;
};

export type SelectOptions = {
  // Seconds between samples.
  step: number;
  maxFrames?: number;
  // Two views split by a single blurry frame are merged when their frames are this alike.
  mergeBelow?: number;
  // A frame this alike to an earlier pick is a repeat.
  repeatBelow?: number;
};

export type Selection = {
  // Indices into `samples`, in time order.
  chosen: number[];
  // Each group of clear frames that showed one view.
  views: number[][];
  minSharpness: number;
};

function percentile(values: number[], q: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

// Chooses the best frames from a scroll or page-flip video.
//
// Measured on real phone video, how a frame *looks* (pixel similarity) cannot tell two text
// pages apart - a hand on a page changes it more than turning to the next page does - but
// *timing* can: flipping a page always leaves blurry frames between the two clear views. So:
//  1. drop blurry frames (page turns, motion) using the sharpness score;
//  2. split the clear frames into views wherever a blurry frame interrupts them;
//  3. merge two views split by only one blurry frame when they look nearly the same;
//  4. keep the sharpest frame of each properly clear view, plus a backup from long views in case a
//     hand covers part of the best one;
//  5. skip near-identical repeats.
// Splitting too much only costs an extra frame (the AI merges frames of one page); merging two
// pages would lose one, so the rules lean towards splitting.
export function selectBestFrames(samples: Sample[], options: SelectOptions): Selection {
  const { step, maxFrames = 30, mergeBelow = 0.12, repeatBelow = 0.06 } = options;
  if (!samples.length) return { chosen: [], views: [], minSharpness: 0 };

  const minSharpness = Math.max(0.15, Math.min(0.45, 0.3 * percentile(samples.map((s) => s.sharpness), 0.9)));
  let good = samples.map((_, i) => i).filter((i) => samples[i].sharpness >= minSharpness);
  if (!good.length) {
    // A uniformly blurry video: still return its best few frames rather than nothing.
    good = samples
      .map((_, i) => i)
      .sort((a, b) => samples[b].sharpness - samples[a].sharpness)
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

  const bySharpness = (a: number, b: number) => samples[b].sharpness - samples[a].sharpness || a - b;
  // A view must be properly clear to be kept. A lone, barely-sharp frame is usually the tail of
  // a page turn, so it needs to be very sharp to count when it is the only frame in its view.
  const keepGate = Math.max(minSharpness * 1.3, Math.min(0.7, 0.45 * percentile(samples.map((s) => s.sharpness), 0.9)));
  const picks: Array<{ index: number; view: number }> = [];
  for (const [viewIndex, view] of merged.entries()) {
    const best = [...view].sort(bySharpness)[0];
    const sharpness = samples[best].sharpness;
    if (sharpness < keepGate || (view.length < 2 && sharpness < 1.5)) continue;
    picks.push({ index: best, view: viewIndex });
    if (view.length >= 12) {
      const far = view.filter((i) => Math.abs(samples[i].timestamp - samples[best].timestamp) >= 1.0);
      const backup = far.sort(bySharpness)[0];
      if (backup !== undefined && samples[backup].sharpness >= minSharpness * 2) picks.push({ index: backup, view: viewIndex });
    }
  }

  // Nothing cleared the bar (a uniformly blurry video): fall back to its sharpest frames, at
  // least a second apart, rather than returning nothing.
  if (!picks.length) {
    for (const index of [...samples.keys()].sort(bySharpness)) {
      if (picks.length >= 3) break;
      if (picks.every((pick) => Math.abs(samples[pick.index].timestamp - samples[index].timestamp) >= 1)) {
        picks.push({ index, view: -1 - picks.length });
      }
    }
  }

  // Skip a pick that repeats one from a different view, keeping the sharper copy.
  let chosen: number[] = [];
  const kept: typeof picks = [];
  for (const pick of [...picks].sort((a, b) => bySharpness(a.index, b.index))) {
    const repeat = kept.some(
      (other) =>
        other.view !== pick.view &&
        alignedDifference(samples[pick.index].signature, samples[other.index].signature) < repeatBelow,
    );
    if (!repeat) kept.push(pick);
  }
  chosen = kept.map((pick) => pick.index);
  if (chosen.length > maxFrames) chosen = chosen.sort(bySharpness).slice(0, maxFrames);
  return { chosen: chosen.sort((a, b) => a - b), views: merged, minSharpness };
}
