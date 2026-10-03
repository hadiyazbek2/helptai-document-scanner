import type { Gray } from './frame-metrics';

// Synthetic images for tests.
// Deterministic pseudo-random numbers so the "text" is the same on every run.
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// A bright page with rows of dark dashes, like lines of text.
export function textPage(seed: number, width = 200, height = 356): Gray {
  const random = rng(seed);
  const data = new Float32Array(width * height).fill(225);
  for (let y = 12; y < height - 12; y += 9) {
    let x = 12;
    while (x < width - 24) {
      const dash = 3 + Math.floor(random() * 14);
      for (let dx = 0; dx < dash && x + dx < width - 12; dx += 1) {
        for (let dy = 0; dy < 3; dy += 1) data[(y + dy) * width + x + dx] = 40;
      }
      x += dash + 3 + Math.floor(random() * 4);
    }
  }
  return { data, width, height };
}

export function blur(gray: Gray, radius: number): Gray {
  const { width, height, data } = gray;
  const out = new Float32Array(data.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let total = 0;
      let count = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const yy = Math.min(height - 1, Math.max(0, y + dy));
          const xx = Math.min(width - 1, Math.max(0, x + dx));
          total += data[yy * width + xx];
          count += 1;
        }
      }
      out[y * width + x] = total / count;
    }
  }
  return { data: out, width, height };
}

export const shift = (gray: Gray, dx: number, dy: number): Gray => {
  const out = new Float32Array(gray.data.length).fill(225);
  for (let y = 0; y < gray.height; y += 1) {
    for (let x = 0; x < gray.width; x += 1) {
      const sx = x - dx;
      const sy = y - dy;
      if (sx >= 0 && sx < gray.width && sy >= 0 && sy < gray.height) out[y * gray.width + x] = gray.data[sy * gray.width + sx];
    }
  }
  return { data: out, width: gray.width, height: gray.height };
};

