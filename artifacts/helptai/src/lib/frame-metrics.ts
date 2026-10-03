// Pure image-quality functions for choosing video frames. They work on plain grayscale arrays
// so they can be tested without a browser.

export type Gray = { data: Float32Array; width: number; height: number };

export function toGray(image: { data: ArrayLike<number>; width: number; height: number }): Gray {
  const { data, width, height } = image;
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i += 1, p += 4) {
    gray[i] = data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114;
  }
  return { data: gray, width, height };
}

// Edge sharpness per tile: mean squared Laplacian, divided by the tile's contrast so dim or
// low-contrast frames are not unfairly scored as blurry. Returned tiles are in raster order.
export function tileSharpness(gray: Gray, columns = 8, rows = 6): number[] {
  const { data, width, height } = gray;
  const tiles: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x0 = Math.max(1, Math.floor((column * width) / columns));
      const x1 = Math.min(width - 1, Math.floor(((column + 1) * width) / columns));
      const y0 = Math.max(1, Math.floor((row * height) / rows));
      const y1 = Math.min(height - 1, Math.floor(((row + 1) * height) / rows));
      let sumSquares = 0;
      let sum = 0;
      let sumValueSquares = 0;
      let count = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const i = y * width + x;
          const laplacian = 4 * data[i] - data[i - 1] - data[i + 1] - data[i - width] - data[i + width];
          sumSquares += laplacian * laplacian;
          sum += data[i];
          sumValueSquares += data[i] * data[i];
          count += 1;
        }
      }
      if (!count) {
        tiles.push(0);
        continue;
      }
      const variance = Math.max(0, sumValueSquares / count - (sum / count) ** 2);
      tiles.push(sumSquares / count / (variance + 100));
    }
  }
  return tiles;
}

// One number for the whole frame: the average of its sharpest 40% of tiles, so a hand or plain
// table covering part of the frame does not hide a sharp page (and a blurry page cannot hide
// behind a sharp corner either, because most of the page tiles must be sharp).
export function frameSharpness(gray: Gray): number {
  const tiles = tileSharpness(gray).sort((a, b) => b - a);
  const top = tiles.slice(0, Math.max(1, Math.round(tiles.length * 0.4)));
  return top.reduce((total, value) => total + value, 0) / top.length;
}

// Maps raw sharpness to a 0..1 score on a log scale. The anchor points are calibrated on real
// phone video: steady page views score about 1.3-3, page flips and motion blur 0.02-0.3.
export const CLARITY_LOW = 0.1;
export const CLARITY_HIGH = 3.0;
export function clarityFromSharpness(sharpness: number) {
  const span = Math.log(CLARITY_HIGH / CLARITY_LOW);
  const value = Math.log(Math.max(sharpness, 1e-6) / CLARITY_LOW) / span;
  return Math.max(0, Math.min(1, value));
}

// Zero-mean, unit-variance copy used to compare frames regardless of exposure.
export function normalize(gray: Gray): Gray {
  const { data } = gray;
  let mean = 0;
  for (let i = 0; i < data.length; i += 1) mean += data[i];
  mean /= data.length;
  let variance = 0;
  for (let i = 0; i < data.length; i += 1) variance += (data[i] - mean) ** 2;
  const scale = 1 / (Math.sqrt(variance / data.length) || 1);
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i += 1) out[i] = (data[i] - mean) * scale;
  return { data: out, width: gray.width, height: gray.height };
}

// How different two frames are, allowing for a small camera shift: the lowest mean absolute
// difference over all shifts within `radius` pixels. Small values mean "same view".
export function alignedDifference(a: Gray, b: Gray, radius = 6): number {
  const { width, height } = a;
  let best = Infinity;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const x0 = Math.max(0, -dx);
      const x1 = Math.min(width, width - dx);
      const y0 = Math.max(0, -dy);
      const y1 = Math.min(height, height - dy);
      let total = 0;
      let count = 0;
      for (let y = y0; y < y1; y += 2) {
        const rowA = y * width;
        const rowB = (y + dy) * width + dx;
        for (let x = x0; x < x1; x += 2) {
          total += Math.abs(a.data[rowA + x] - b.data[rowB + x]);
          count += 1;
        }
      }
      if (count) best = Math.min(best, total / count);
    }
  }
  return best === Infinity ? 2 : best;
}
