import type { Box, PageBlock } from '@helptai/api-client-react';
import { wrapText } from './export/text';

export type { Box, PageBlock };
export type Rect = { x: number; y: number; width: number; height: number };

// Average character width of the body font as a share of its size, and line height.
const CHAR_WIDTH = 0.52;
const LINE_HEIGHT = 1.28;
const MAX_SPREAD = 2;

// A box is [ymin, xmin, ymax, xmax] in 0..1000. Returns fractions (0..1) of the image.
export function boxToRect(box: Box): Rect {
  const [ymin, xmin, ymax, xmax] = box;
  return { x: xmin / 1000, y: ymin / 1000, width: (xmax - xmin) / 1000, height: (ymax - ymin) / 1000 };
}

export type PageSpace = {
  // The part of the original image that is the page, as fractions of the image.
  region: Rect;
  // Height divided by width of that region in real pixels.
  aspect: number;
};

// The page area to rebuild into. Uses the page region Gemini found when it is plausible, and
// otherwise the whole image.
export function pageSpace(page: { pageBox: Box | null; imageSize: { width: number; height: number } }): PageSpace {
  const whole: Rect = { x: 0, y: 0, width: 1, height: 1 };
  let region = whole;
  if (page.pageBox) {
    const candidate = boxToRect(page.pageBox);
    if (candidate.width >= 0.3 && candidate.height >= 0.3 && candidate.width * candidate.height >= 0.2) region = candidate;
  }
  const { width, height } = page.imageSize;
  return { region, aspect: (region.height * height) / (region.width * width) };
}

// A block's position inside the page space, as fractions (0..1) of the page, clamped to it.
export function blockRect(box: Box | null, space: PageSpace): Rect | null {
  if (!box) return null;
  const rect = boxToRect(box);
  const { region } = space;
  const x0 = Math.max(0, (rect.x - region.x) / region.width);
  const y0 = Math.max(0, (rect.y - region.y) / region.height);
  const x1 = Math.min(1, (rect.x + rect.width - region.x) / region.width);
  const y1 = Math.min(1, (rect.y + rect.height - region.y) / region.height);
  return x1 - x0 > 0.01 && y1 - y0 > 0.005 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

// The lines of text a block shows (lists get bullets, table rows are joined).
export function blockLines(block: PageBlock): string[] {
  if (block.type === 'list') return (block.items ?? []).map((item) => `• ${item}`);
  if (block.type === 'table') return (block.rows ?? []).map((row) => row.map((cell) => cell.replace(/\s*\n\s*/g, ' ')).join('    '));
  return block.text ? block.text.split('\n').map((line) => line.trim()).filter(Boolean) : [];
}

export type FittedText = { fontSize: number; lines: string[]; lineHeight: number };

// The largest font size at which the text, wrapped, fits inside the given width and height
// (same units for all three). Line breaks inside the text are kept. With `spread`, a block
// that has room to spare gets its lines spaced out over the whole box height, as
// they are on a handwritten or loosely spaced page.
export function fitText(lines: string[], width: number, height: number, maxFontSize = Infinity, spread = false): FittedText {
  const source = lines.join('\n');
  const minFontSize = 2;
  const finish = (fontSize: number, wrapped: string[]): FittedText => {
    const natural = fontSize * LINE_HEIGHT;
    const roomy = height / wrapped.length;
    const ratio = spread && roomy > natural ? Math.min(roomy, fontSize * MAX_SPREAD) / fontSize : LINE_HEIGHT;
    return { fontSize, lines: wrapped, lineHeight: ratio };
  };
  let fontSize = Math.min(maxFontSize, height / LINE_HEIGHT);
  for (; fontSize > minFontSize; fontSize *= 0.94) {
    const wrapped = wrapText(source, Math.max(1, Math.floor(width / (fontSize * CHAR_WIDTH))));
    if (wrapped.length * fontSize * LINE_HEIGHT <= height) return finish(fontSize, wrapped);
  }
  return finish(minFontSize, wrapText(source, Math.max(1, Math.floor(width / (minFontSize * CHAR_WIDTH)))));
}

export const lineHeight = LINE_HEIGHT;
