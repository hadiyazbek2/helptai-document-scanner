export type SelectedFrame = {
  dataUrl: string;
  timestamp: number;
  sharpness: number;
  difference: number;
};

type SampledFrame = SelectedFrame & { signature: number[] };

export async function selectVideoFrames(
  file: File,
  onProgress?: (message: string) => void,
): Promise<SelectedFrame[]> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  video.src = url;

  try {
    await waitForVideo(video);
    if (!video.duration || !Number.isFinite(video.duration)) {
      throw new Error("This video does not have a readable duration.");
    }

    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("This browser cannot inspect video frames.");

    const sampleCount = Math.min(48, Math.max(8, Math.ceil(video.duration * 4)));
    const samples: SampledFrame[] = [];
    let previousSignature: number[] | null = null;

    for (let index = 0; index < sampleCount; index += 1) {
      const timestamp =
        sampleCount === 1
          ? 0
          : (video.duration * index) / (sampleCount - 1);
      await seekVideo(video, Math.min(timestamp, Math.max(0, video.duration - 0.04)));
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const signature = makeSignature(image);
      const difference = previousSignature
        ? signatureDistance(signature, previousSignature)
        : 1;
      const sharpness = measureSharpness(image);

      samples.push({
        dataUrl: canvas.toDataURL("image/jpeg", 0.74),
        timestamp,
        sharpness,
        difference,
        signature,
      });
      previousSignature = signature;
      onProgress?.(`Reading frame ${index + 1} of ${sampleCount}…`);
    }

    const buckets = Array.from({ length: Math.min(12, samples.length) }, () => [] as SampledFrame[]);
    samples.forEach((sample, index) => {
      buckets[Math.min(buckets.length - 1, Math.floor((index * buckets.length) / samples.length))].push(sample);
    });

    const chosen: SampledFrame[] = [];
    for (const bucket of buckets) {
      const best = [...bucket].sort(
        (left, right) =>
          right.sharpness * (0.7 + right.difference) -
          left.sharpness * (0.7 + left.difference),
      )[0];
      if (!best) continue;
      const isNearDuplicate = chosen.some(
        (selected) => signatureDistance(selected.signature, best.signature) < 0.055,
      );
      if (!isNearDuplicate) chosen.push(best);
    }

    if (!chosen.length && samples[0]) chosen.push(samples[0]);
    return chosen
      .sort((left, right) => left.timestamp - right.timestamp)
      .map(({ signature: _signature, ...frame }) => frame);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function waitForVideo(video: HTMLVideoElement) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error("The video could not be opened.")),
      15000,
    );
    video.onloadedmetadata = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    video.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error("The video could not be opened."));
    };
  });
}

function seekVideo(video: HTMLVideoElement, time: number) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error("The video frame could not be read.")),
      10000,
    );
    const finish = () => {
      window.clearTimeout(timeout);
      video.removeEventListener("seeked", finish);
      resolve();
    };
    video.addEventListener("seeked", finish, { once: true });
    video.currentTime = time;
  });
}

function makeSignature(image: ImageData) {
  const signature: number[] = [];
  const stepX = Math.max(1, Math.floor(image.width / 24));
  const stepY = Math.max(1, Math.floor(image.height / 24));
  for (let y = 0; y < image.height; y += stepY) {
    for (let x = 0; x < image.width; x += stepX) {
      const offset = (y * image.width + x) * 4;
      signature.push(
        (image.data[offset] * 0.299 +
          image.data[offset + 1] * 0.587 +
          image.data[offset + 2] * 0.114) /
          255,
      );
    }
  }
  return signature;
}

function signatureDistance(left: number[], right: number[]) {
  const size = Math.min(left.length, right.length);
  if (!size) return 1;
  let difference = 0;
  for (let index = 0; index < size; index += 1) {
    difference += Math.abs(left[index] - right[index]);
  }
  return difference / size;
}

function measureSharpness(image: ImageData) {
  const grayscale = makeSignature(image);
  const columns = Math.max(1, Math.floor(image.width / 24));
  let total = 0;
  let count = 0;
  for (let index = columns; index < grayscale.length; index += 1) {
    total += Math.abs(grayscale[index] - grayscale[index - columns]);
    count += 1;
  }
  return count ? Math.min(1, (total / count) * 7) : 0;
}