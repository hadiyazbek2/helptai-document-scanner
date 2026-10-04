import {
  alignedDifference,
  clarityFromSharpness,
  frameSharpness,
  normalize,
  toGray,
} from './frame-metrics';
import { selectBestFrames, type Sample } from './frame-selection';

export type SelectedFrame = {
  dataUrl: string;
  width: number;
  height: number;
  timestamp: number;
  // Clarity from 0 (blurry) to 1 (sharp), shown to the user and sent as a hint to Gemini.
  sharpness: number;
  // How much this view differs from the previously chosen one.
  difference: number;
};

const ANALYSIS_EDGE = 800; // long edge for the sharpness measurement
const SIGNATURE_EDGE = 200; // long edge for comparing views
const OUTPUT_EDGE = 1400; // long edge of the frames we keep and send
const OUTPUT_QUALITY = 0.82;
const MAX_SAMPLES = 150;
const MAX_FRAMES = 45;

export async function selectVideoFrames(
  file: File,
  onProgress?: (message: string) => void,
  options: { method?: 'auto' | 'seek' } = {},
): Promise<SelectedFrame[]> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;
  video.src = url;

  try {
    await waitForVideo(video);
    const duration = await readDuration(video);

    const analysis = makeCanvas(video, ANALYSIS_EDGE);
    const signature = makeCanvas(video, SIGNATURE_EDGE);

    const step = Math.max(0.2, duration / MAX_SAMPLES);
    const total = Math.max(1, Math.floor((duration - 0.05) / step) + 1);

    const measure = (timestamp: number): Sample => {
      analysis.context.drawImage(video, 0, 0, analysis.canvas.width, analysis.canvas.height);
      signature.context.drawImage(video, 0, 0, signature.canvas.width, signature.canvas.height);
      return {
        timestamp,
        sharpness: frameSharpness(toGray(analysis.context.getImageData(0, 0, analysis.canvas.width, analysis.canvas.height))),
        signature: normalize(toGray(signature.context.getImageData(0, 0, signature.canvas.width, signature.canvas.height))),
      };
    };
    const progress = (count: number) => onProgress?.(`Looking at frame ${Math.min(count, total)} of ${total}…`);

    // Playing the video quickly is about twice as fast as jumping to every sample (seeking costs
    // ~100 ms each); browsers without frame callbacks, or where playback stalls, seek instead.
    let samples: Sample[] = [];
    if (options.method !== 'seek' && supportsFrameCallback(video)) {
      try {
        samples = await sampleByPlayback(video, step, duration, measure, progress);
      } catch {
        samples = [];
      }
    }
    if (samples.length < 2) samples = await sampleBySeeking(video, step, duration, measure, progress);

    onProgress?.('Choosing the clearest view of each page…');
    const { chosen } = selectBestFrames(samples, { step, maxFrames: MAX_FRAMES });

    // Second pass: re-read only the chosen moments at full quality.
    const output = makeCanvas(video, OUTPUT_EDGE);
    const frames: SelectedFrame[] = [];
    for (let position = 0; position < chosen.length; position += 1) {
      const sample = samples[chosen[position]];
      await seekVideo(video, sample.timestamp);
      output.context.drawImage(video, 0, 0, output.canvas.width, output.canvas.height);
      const previous = position ? samples[chosen[position - 1]] : null;
      frames.push({
        dataUrl: output.canvas.toDataURL('image/jpeg', OUTPUT_QUALITY),
        width: output.canvas.width,
        height: output.canvas.height,
        timestamp: sample.timestamp,
        sharpness: clarityFromSharpness(sample.sharpness),
        difference: previous ? alignedDifference(sample.signature, previous.signature) : 1,
      });
      onProgress?.(`Preparing frame ${position + 1} of ${chosen.length}…`);
    }
    return frames;
  } finally {
    URL.revokeObjectURL(url);
  }
}

type VideoWithFrames = HTMLVideoElement & {
  requestVideoFrameCallback: (callback: (now: number, metadata: { mediaTime: number }) => void) => number;
};

function supportsFrameCallback(video: HTMLVideoElement): video is VideoWithFrames {
  return typeof (video as Partial<VideoWithFrames>).requestVideoFrameCallback === 'function';
}

// One sample every `step` seconds, read as the video plays at high speed.
async function sampleByPlayback(
  video: VideoWithFrames,
  step: number,
  duration: number,
  measure: (timestamp: number) => Sample,
  progress: (count: number) => void,
): Promise<Sample[]> {
  await seekVideo(video, 0);
  video.playbackRate = 4;
  const samples: Sample[] = [];
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
        samples.push(measure(time));
        progress(samples.length);
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

async function sampleBySeeking(
  video: HTMLVideoElement,
  step: number,
  duration: number,
  measure: (timestamp: number) => Sample,
  progress: (count: number) => void,
): Promise<Sample[]> {
  video.playbackRate = 1;
  const samples: Sample[] = [];
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
    video.currentTime = Math.min(time, Math.max(0, video.duration - 0.04));
  });
}
