// Finds a hand (or anything skin-coloured) on the page, from colour alone, without a model.
//
// A hand over a notebook is warm-coloured and sits *inside* the paper's outline. The table around
// the notebook is often warm-coloured too (wood, a pink floor), so colour on its own is not enough:
// we first find the page (the largest region of paper-coloured pixels, whatever the paper's own tint
// is) and only count warm pixels inside that page's outline.

export type RgbImage = { data: ArrayLike<number>; width: number; height: number };

export type HandResult = {
  // Share of the page's outline covered by warm, non-paper pixels (0..1).
  fraction: number;
  // Where the page was found, as fractions of the image: [x0, y0, x1, y1]; null if none was found.
  page: [number, number, number, number] | null;
  // Share of the picture that is paper (a quick "is a page in view" measure).
  paperShare: number;
  // Which pixels were counted as hand (only when asked for, for debugging and tests).
  mask?: Uint8Array;
};

const BLOCK = 4; // pixels per block when looking for the page region

type Point = [number, number];

// Convex hull (Andrew's monotone chain), counter-clockwise.
function convexHull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted;
  const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Point[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (const p of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

// For each pixel row, the leftmost and rightmost x inside a convex polygon (null outside it).
function rowRanges(polygon: Point[], height: number): Array<[number, number] | null> {
  const ranges: Array<[number, number] | null> = Array.from({ length: height }, () => null);
  for (let y = 0; y < height; y += 1) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < polygon.length; i += 1) {
      const [x1, y1] = polygon[i];
      const [x2, y2] = polygon[(i + 1) % polygon.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        const x = x1 + ((y - y1) / (y2 - y1)) * (x2 - x1);
        lo = Math.min(lo, x);
        hi = Math.max(hi, x);
      }
    }
    if (lo <= hi) ranges[y] = [lo, hi];
  }
  return ranges;
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

export function detectHand(image: RgbImage, options: { mask?: boolean } = {}): HandResult {
  const { data, width, height } = image;
  const count = width * height;
  const r = new Float32Array(count);
  const g = new Float32Array(count);
  const b = new Float32Array(count);
  const v = new Float32Array(count); // brightness (largest channel)
  for (let i = 0, p = 0; i < count; i += 1, p += 4) {
    r[i] = data[p];
    g[i] = data[p + 1];
    b[i] = data[p + 2];
    v[i] = Math.max(r[i], g[i], b[i]);
  }

  // The paper's own colour: the median of the brightest third of the picture.
  const brightness = Array.from(v).sort((a, c) => a - c);
  const cutoff = brightness[Math.floor(count * 0.66)];
  const lr: number[] = [];
  const lg: number[] = [];
  const lb: number[] = [];
  for (let i = 0; i < count; i += 1) {
    if (v[i] >= cutoff) {
      lr.push(r[i]);
      lg.push(g[i]);
      lb.push(b[i]);
    }
  }
  const pr = median(lr);
  const pg = median(lg);
  const pb = median(lb);
  const pv = Math.max(pr, pg, pb, 1);
  // Paper is white, grey or a pale tint. A strongly coloured "brightest third" (wood, a pink floor)
  // means there is no page in view, and we must not mistake the table for one.
  const paperSaturation = (pv - Math.min(pr, pg, pb)) / pv;
  if (paperSaturation > 0.35) return { fraction: 0, page: null, paperShare: 0 };
  const paperSum = pr + pg + pb || 1;
  const paperR = pr / paperSum;
  const paperB = pb / paperSum;

  const paper = new Uint8Array(count);
  const warm = new Uint8Array(count);
  let paperPixels = 0;
  for (let i = 0; i < count; i += 1) {
    const sum = r[i] + g[i] + b[i] || 1;
    const cr = r[i] / sum;
    const cb = b[i] / sum;
    const bright = v[i] > 0.5 * pv;
    // Paper: bright and the same colour as the page itself.
    if (bright && Math.abs(cr - paperR) < 0.045 && Math.abs(cb - paperB) < 0.045) {
      paper[i] = 1;
      paperPixels += 1;
    } else if (v[i] > 0.28 * pv && cr - paperR > 0.035 && cb < paperB - 0.01 && r[i] > g[i]) {
      // Warmer than the paper (more red, less blue): skin, wood, a pink floor.
      warm[i] = 1;
    }
  }

  // The page: the largest connected group of mostly-paper blocks.
  const gw = Math.ceil(width / BLOCK);
  const gh = Math.ceil(height / BLOCK);
  const isPage = new Uint8Array(gw * gh);
  for (let by = 0; by < gh; by += 1) {
    for (let bx = 0; bx < gw; bx += 1) {
      let total = 0;
      let paperCount = 0;
      for (let y = by * BLOCK; y < Math.min(height, (by + 1) * BLOCK); y += 1) {
        for (let x = bx * BLOCK; x < Math.min(width, (bx + 1) * BLOCK); x += 1) {
          total += 1;
          paperCount += paper[y * width + x];
        }
      }
      isPage[by * gw + bx] = paperCount / total > 0.4 ? 1 : 0;
    }
  }
  // Erode the page blocks once (a block survives only if its neighbours are page too) so that
  // narrow bridges of light floor or table around the notebook are cut off from the page itself.
  const solid = new Uint8Array(gw * gh);
  for (let by = 1; by < gh - 1; by += 1) {
    for (let bx = 1; bx < gw - 1; bx += 1) {
      const at = by * gw + bx;
      solid[at] = isPage[at] && isPage[at - 1] && isPage[at + 1] && isPage[at - gw] && isPage[at + gw] ? 1 : 0;
    }
  }
  const seen = new Uint8Array(gw * gh);
  let best: { size: number; x0: number; y0: number; x1: number; y1: number; cells: number[] } | null = null;
  for (let start = 0; start < isPage.length; start += 1) {
    if (!solid[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    const box = { size: 0, x0: gw, y0: gh, x1: 0, y1: 0, cells: [] as number[] };
    while (stack.length) {
      const cell = stack.pop() as number;
      const cx = cell % gw;
      const cy = (cell - cx) / gw;
      box.size += 1;
      box.cells.push(cell);
      box.x0 = Math.min(box.x0, cx);
      box.x1 = Math.max(box.x1, cx);
      box.y0 = Math.min(box.y0, cy);
      box.y1 = Math.max(box.y1, cy);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const next = ny * gw + nx;
        if (solid[next] && !seen[next]) {
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    if (!best || box.size > best.size) best = box;
  }

  const paperShare = paperPixels / count;
  // No page worth the name (less than ~4% of the picture): nothing to cover.
  if (!best || best.size < gw * gh * 0.04) return { fraction: 0, page: null, paperShare };

  // Count only inside the page's own outline (the convex hull of its blocks), pulled in by 5% so the
  // blank margin is ignored: a hand resting beside the notebook, or holding the page by its edge
  // without covering any writing, does not matter. A bounding box would include floor or table in
  // its corners whenever the notebook is tilted.
  const pageWidth = (best.x1 - best.x0 + 1) * BLOCK;
  const pageHeight = (best.y1 - best.y0 + 1) * BLOCK;
  const margin = Math.max(2, Math.round(Math.min(pageWidth, pageHeight) * 0.05));
  const corners: Point[] = [];
  for (const cell of best.cells) {
    const cx = (cell % gw) * BLOCK;
    const cy = Math.floor(cell / gw) * BLOCK;
    corners.push([cx, cy], [cx + BLOCK, cy], [cx, cy + BLOCK], [cx + BLOCK, cy + BLOCK]);
  }
  const ranges = rowRanges(convexHull(corners), height);
  const x0 = Math.max(0, best.x0 * BLOCK);
  const y0 = Math.max(0, best.y0 * BLOCK);
  const x1 = Math.min(width, (best.x1 + 1) * BLOCK);
  const y1 = Math.min(height, (best.y1 + 1) * BLOCK);
  let handPixels = 0;
  let area = 0;
  const mask = options.mask ? new Uint8Array(count) : undefined;
  const solidWarm = (x: number, y: number) => {
    if (!warm[y * width + x]) return 0;
    let near = 0;
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height) near += warm[ny * width + nx];
      }
    }
    return near >= 20 ? 1 : 0; // at least 20 of the 25 pixels around it are warm too
  };
  for (let y = y0; y < y1; y += 1) {
    const range = ranges[y];
    if (!range) continue;
    const from = Math.max(x0, Math.ceil(range[0] + margin));
    const to = Math.min(x1, Math.floor(range[1] - margin));
    for (let x = from; x < to; x += 1) {
      area += 1;
      const hand = solidWarm(x, y);
      handPixels += hand;
      if (mask) mask[y * width + x] = hand;
    }
  }
  area = Math.max(1, area);
  return { fraction: handPixels / area, page: [x0 / width, y0 / height, x1 / width, y1 / height], paperShare, mask };
}
