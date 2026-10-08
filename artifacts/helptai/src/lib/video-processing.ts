import { alignedDifference, clarityFromSharpness, frameSharpness, normalize, toGray, type Gray } from './frame-metrics';
import { detectHand } from './frame-hand';
import { findPageSegments, pageCover, type Moment } from './page-segments';

export type SelectionStats = {
  videoSeconds: number;
  width: number;
  height: number;
  samples: number;
  // Page views found (each gives one frame, long ones a few).
  views: number;
  seconds: number;
  method: 'playback' | 'seeking';
};

export type SelectedFrame = {
  dataUrl: string;
  width: number;
  height: number;
  timestamp: number;
  // Clarity from 0 (blurry) to 1 (sharp), shown to the user and sent as a hint to Gemini.
  sharpness: number;
  // How much this view differs from the previously chosen one.
  difference: number;
  // How much of the page something (a hand) covers (0..1): the larger of the hand found on the
  // page and the paper hidden compared with nearby frames.
  hand: number;
  // Which page view of the video this frame comes from, and the stretch of video (seconds) that
  // shows that page: the user can scrub through it to choose a different frame.
  view: number;
  range: { from: number; to: number };
  // An extra frame from a long view (a slow scroll, or a page held still for a while); the AI
  // merges it with the view's main frame when they show the same page.
  extra: boolean;
  // True when the user chose this frame themselves instead of the automatic choice.
  picked?: boolean;
};

const ANALYSIS_EDGE = 800; // long edge for the sharpness measurement
const MOTION_EDGE = 48; // long edge of the grey copy used to measure motion between moments
const HAND_EDGE = 120; // long edge for finding the page and a hand on it
const OUTPUT_EDGE = 1400; // long edge of the frames we keep and send
const OUTPUT_QUALITY = 0.82;
// Moments are read every 0.1 s: a page flip can take only a few tenths of a second, and a coarser
// step missed some flips on the test videos. Very long videos get a coarser step to bound the work.
const MIN_STEP = 0.1;
const MAX_SAMPLES = 900;
const MAX_FRAMES = 45;
// Playing faster skips frames between callbacks: at 4x the moments were ~0.15 s apart and a page
// flip was missed on the test videos.
const PLAYBACK_RATE = 2;

type Sample = Moment & { hand: number; paperShare: number; tiny: Gray };

export async function selectVideoFrames(
  file: File,
  // `fraction` (0..1) is how far selection has got, for a progress bar.
  onProgress?: (message: string, fraction?: number) => void,
  // `signal`: aborting it stops the work (the user pressed cancel); the promise then rejects with
  // an AbortError.
  options: { method?: 'auto' | 'seek'; onStats?: (stats: SelectionStats) => void; signal?: AbortSignal } = {},
): Promise<SelectedFrame[]> {
  const source = await openVideo(file);
  const { video, duration } = source;
  try {
    const startedAt = performance.now();
    const analysis = makeCanvas(video, ANALYSIS_EDGE);
    const motionView = makeCanvas(video, MOTION_EDGE);
    const handView = makeCanvas(video, HAND_EDGE);

    const step = Math.max(MIN_STEP, duration / MAX_SAMPLES);
    const total = Math.max(1, Math.floor((duration - 0.05) / step) + 1);

    let previousTiny: Gray | null = null;
    const measure = (timestamp: number): Sample => {
      analysis.context.drawImage(video, 0, 0, analysis.canvas.width, analysis.canvas.height);
      motionView.context.drawImage(video, 0, 0, motionView.canvas.width, motionView.canvas.height);
      handView.context.drawImage(video, 0, 0, handView.canvas.width, handView.canvas.height);
      const tiny = normalize(toGray(motionView.context.getImageData(0, 0, motionView.canvas.width, motionView.canvas.height)));
      const hand = detectHand(handView.context.getImageData(0, 0, handView.canvas.width, handView.canvas.height));
      const sample: Sample = {
        timestamp,
        sharpness: frameSharpness(toGray(analysis.context.getImageData(0, 0, analysis.canvas.width, analysis.canvas.height))),
        motion: previousTiny ? meanDifference(tiny, previousTiny) : 0,
        hand: hand.fraction,
        paperShare: hand.paperShare,
        tiny,
      };
      previousTiny = tiny;
      return sample;
    };
    // Reading the moments is ~90% of the work; preparing the chosen frames the rest.
    const progress = (count: number) => {
      throwIfCancelled(options.signal);
      onProgress?.(`Looking at moment ${Math.min(count, total)} of ${total}…`, 0.9 * Math.min(1, count / total));
    };

    // Playing the video is faster than jumping to every moment (seeking costs ~100 ms each);
    // browsers without frame callbacks, or where playback stalls, seek instead.
    let samples: Sample[] = [];
    let method: SelectionStats['method'] = 'seeking';
    if (options.method !== 'seek' && supportsFrameCallback(video)) {
      try {
        samples = await sampleByPlayback(video, step, duration, measure, progress);
        method = 'playback';
      } catch (error) {
        if (isCancelled(error)) throw error;
        samples = [];
      }
    }
    if (samples.length < 2) {
      previousTiny = null;
      samples = await sampleBySeeking(video, step, duration, measure, progress);
      method = 'seeking';
    }

    onProgress?.('Finding where each page starts and ends…', 0.9);
    const cover = pageCover(samples);
    const segments = findPageSegments(
      samples.map((sample, i) => ({ ...sample, cover: cover[i] })),
      { maxFrames: MAX_FRAMES },
    );
    const chosen = segments
      .flatMap((segment, view) => [segment.best, ...segment.extras].map((index) => ({ index, view, extra: index !== segment.best, range: { from: segment.from, to: segment.to } })))
      .sort((a, b) => a.index - b.index);

    // Second pass: re-read only the chosen moments at full quality.
    const frames: SelectedFrame[] = [];
    for (let position = 0; position < chosen.length; position += 1) {
      const { index, view, extra, range } = chosen[position];
      const sample = samples[index];
      const previous = position ? samples[chosen[position - 1].index] : null;
      frames.push({
        ...(await source.capture(sample.timestamp)),
        timestamp: sample.timestamp,
        sharpness: clarityFromSharpness(sample.sharpness),
        difference: previous ? alignedDifference(sample.tiny, previous.tiny, 2) : 1,
        hand: cover[index],
        view,
        extra,
        range,
      });
      throwIfCancelled(options.signal);
      onProgress?.(`Preparing frame ${position + 1} of ${chosen.length}…`, 0.9 + (0.1 * (position + 1)) / chosen.length);
    }
    options.onStats?.({
      videoSeconds: duration,
      width: video.videoWidth,
      height: video.videoHeight,
      samples: samples.length,
      views: segments.length,
      seconds: (performance.now() - startedAt) / 1000,
      method,
    });
    return frames;
  } finally {
    source.close();
  }
}

// One moment of a video as shown in the frame picker.
export type FrameCheck = { timestamp: number; thumb: string; clarity: number; hand: number };

export type VideoSource = {
  video: HTMLVideoElement;
  duration: number;
  // The frame at `timestamp`, at full output quality.
  capture: (timestamp: number) => Promise<{ dataUrl: string; width: number; height: number }>;
  // Looks at `count` evenly spaced moments between `from` and `to` and scores each one, so the
  // user can see at a glance which frames of a page are clear and which have a hand on them.
  scan: (from: number, to: number, count: number, onEach?: (done: number) => void) => Promise<FrameCheck[]>;
  // Scores the single frame at `timestamp` (for a frame chosen by hand with the slider).
  check: (timestamp: number) => Promise<Omit<FrameCheck, 'thumb'>>;
  close: () => void;
};

export async function openVideo(file: Blob): Promise<VideoSource> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  try {
    await waitForVideo(video);
    const duration = await readDuration(video);
    let output: ReturnType<typeof makeCanvas> | null = null;
    let thumbView: ReturnType<typeof makeCanvas> | null = null;
    let analysis: ReturnType<typeof makeCanvas> | null = null;
    let handView: ReturnType<typeof makeCanvas> | null = null;
    const score = () => {
      analysis ??= makeCanvas(video, ANALYSIS_EDGE);
      handView ??= makeCanvas(video, HAND_EDGE);
      analysis.context.drawImage(video, 0, 0, analysis.canvas.width, analysis.canvas.height);
      handView.context.drawImage(video, 0, 0, handView.canvas.width, handView.canvas.height);
      const sharpness = frameSharpness(toGray(analysis.context.getImageData(0, 0, analysis.canvas.width, analysis.canvas.height)));
      const hand = detectHand(handView.context.getImageData(0, 0, handView.canvas.width, handView.canvas.height));
      return { clarity: clarityFromSharpness(sharpness), hand: hand.fraction, paperShare: hand.paperShare };
    };
    return {
      video,
      duration,
      capture: async (timestamp) => {
        await seekVideo(video, timestamp);
        output ??= makeCanvas(video, OUTPUT_EDGE);
        output.context.drawImage(video, 0, 0, output.canvas.width, output.canvas.height);
        return { dataUrl: output.canvas.toDataURL('image/jpeg', OUTPUT_QUALITY), width: output.canvas.width, height: output.canvas.height };
      },
      scan: async (from, to, count, onEach) => {
        thumbView ??= makeCanvas(video, 240);
        const moments: Array<{ timestamp: number; thumb: string; clarity: number; hand: number; paperShare: number }> = [];
        const span = Math.max(0, Math.min(to, duration) - from);
        const n = Math.max(1, Math.min(count, Math.floor(span * 15) + 1));
        for (let k = 0; k < n; k += 1) {
          const timestamp = n === 1 ? from : from + (span * k) / (n - 1);
          await seekVideo(video, timestamp);
          thumbView.context.drawImage(video, 0, 0, thumbView.canvas.width, thumbView.canvas.height);
          moments.push({ timestamp, thumb: thumbView.canvas.toDataURL('image/jpeg', 0.7), ...score() });
          onEach?.(k + 1);
        }
        // Judge hidden paper against the rest of this page's frames, as the automatic choice does.
        const cover = pageCover(moments, Infinity);
        return moments.map(({ timestamp, thumb, clarity }, k) => ({ timestamp, thumb, clarity, hand: cover[k] }));
      },
      check: async (timestamp) => {
        await seekVideo(video, timestamp);
        const { clarity, hand } = score();
        return { timestamp, clarity, hand };
      },
      close: () => {
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(url);
      },
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

export function isCancelled(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

function throwIfCancelled(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
}

// Mean absolute difference of two same-sized grey copies: how much the picture changed.
function meanDifference(a: Gray, b: Gray) {
  let total = 0;
  for (let i = 0; i < a.data.length; i += 1) total += Math.abs(a.data[i] - b.data[i]);
  return total / a.data.length;
}

type VideoWithFrames = HTMLVideoElement & {
  requestVideoFrameCallback: (callback: (now: number, metadata: { mediaTime: number }) => void) => number;
};

function supportsFrameCallback(video: HTMLVideoElement): video is VideoWithFrames {
  return typeof (video as Partial<VideoWithFrames>).requestVideoFrameCallback === 'function';
}

// One sample every `step` seconds, read as the video plays at high speed.
async function sampleByPlayback<T>(
  video: VideoWithFrames,
  step: number,
  duration: number,
  measure: (timestamp: number) => T,
  progress: (count: number) => void,
): Promise<T[]> {
  await seekVideo(video, 0);
  video.playbackRate = PLAYBACK_RATE;
  const samples: T[] = [];
  let next = 0;
  await new Promise<void>((resolve, reject) => {
    let watchdog = window.setTimeout(() => reject(new Error('Playback stalled.')), 5000);
    const finish = () => {
      window.clearTimeout(watchdog);
      video.pause();
      resolve();
    };
    const onFrame = (_now: number, metadata: { mediaTime: number }) => {
      window.clearTimeout(watchdog);
      watchdog = window.setTimeout(() => reject(new Error('Playback stalled.')), 5000);
      const time = metadata.mediaTime;
      if (time >= next - 1e-3) {
        try {
          samples.push(measure(time));
          progress(samples.length);
        } catch (error) {
          // Cancelled (or a frame could not be read): stop here rather than inside the callback.
          window.clearTimeout(watchdog);
          reject(error);
          return;
        }
        while (next <= time) next += step; // never fall behind if frames were skipped
      }
      if (video.ended || time >= duration - 0.06) finish();
      else video.requestVideoFrameCallback(onFrame);
    };
    video.addEventListener('ended', finish, { once: true });
    video.requestVideoFrameCallback(onFrame);
    video.play().catch(reject);
  }).catch((error) => {
    video.pause();
    throw error;
  });
  return samples;
}

async function sampleBySeeking<T>(
  video: HTMLVideoElement,
  step: number,
  duration: number,
  measure: (timestamp: number) => T,
  progress: (count: number) => void,
): Promise<T[]> {
  video.playbackRate = 1;
  const samples: T[] = [];
  for (let t = 0; t < duration - 0.05 || !samples.length; t += step) {
    await seekVideo(video, t);
    samples.push(measure(t));
    progress(samples.length);
  }
  return samples;
}

function makeCanvas(video: HTMLVideoElement, longEdge: number) {
  const scale = Math.min(1, longEdge / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('This browser cannot inspect video frames.');
  return { canvas, context };
}

function waitForVideo(video: HTMLVideoElement) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('The video could not be opened.')), 15000);
    video.onloadedmetadata = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    video.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error('The video could not be opened.'));
    };
  });
}

// Videos recorded in the browser (MediaRecorder) often report an infinite duration until the
// end has been reached once. Seeking far past the end forces the real value to be computed.
async function readDuration(video: HTMLVideoElement) {
  if (video.duration === Infinity) {
    await new Promise<void>((resolve) => {
      const timeout = window.setTimeout(resolve, 5000);
      video.addEventListener(
        'durationchange',
        () => {
          if (Number.isFinite(video.duration)) {
            window.clearTimeout(timeout);
            resolve();
          }
        },
      );
      video.currentTime = 1e101;
    });
    video.currentTime = 0;
  }
  if (!video.duration || !Number.isFinite(video.duration)) {
    throw new Error('This video does not have a readable duration.');
  }
  return video.duration;
}

function seekVideo(video: HTMLVideoElement, time: number) {
  const target = Math.min(Math.max(0, time), Math.max(0, video.duration - 0.04));
  // Already there (seeking to the current time fires no "seeked" event in some browsers).
  if (Math.abs(video.currentTime - target) < 1e-4 && video.readyState >= 2) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('The video frame could not be read.')), 10000);
    video.addEventListener(
      'seeked',
      () => {
        window.clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
    video.currentTime = target;
  });
}
