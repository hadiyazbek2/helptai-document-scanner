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
const MAX_FRAMES = 30;

export async function selectVideoFrames(
  file: File,
  onProgress?: (message: string) => void,
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
    const timestamps: number[] = [];
    for (let t = 0; t < duration - 0.05; t += step) timestamps.push(t);
    if (!timestamps.length) timestamps.push(0);

    const samples: Sample[] = [];
    for (let index = 0; index < timestamps.length; index += 1) {
      await seekVideo(video, timestamps[index]);
      analysis.context.drawImage(video, 0, 0, analysis.canvas.width, analysis.canvas.height);
      signature.context.drawImage(video, 0, 0, signature.canvas.width, signature.canvas.height);
      samples.push({
        timestamp: timestamps[index],
        sharpness: frameSharpness(toGray(analysis.context.getImageData(0, 0, analysis.canvas.width, analysis.canvas.height))),
        signature: normalize(toGray(signature.context.getImageData(0, 0, signature.canvas.width, signature.canvas.height))),
      });
      onProgress?.(`Looking at frame ${index + 1} of ${timestamps.length}…`);
    }

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
