import type { Doc } from '../doc-model';
import { concatBytes, utf8 } from './bytes';
import { blockLines, boxToRect, fitText } from '../layout';
import { fitInside, parseJpegDataUrl } from './jpeg';
import { pdfString } from './text';

const MARGIN = 28;

function pdfDate(date: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `D:${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`;
}

type PdfObject = Uint8Array;

const obj = (dictionary: string): PdfObject => utf8(dictionary);
const stream = (dictionary: string, data: Uint8Array): PdfObject =>
  concatBytes([utf8(`<< ${dictionary} /Length ${data.length} >>\nstream\n`), data, utf8('\nendstream')]);

type Area = { x: number; y: number; width: number; height: number };

// Invisible text for one page. Blocks with a known position get their text placed where they
// are on the photo, so searching highlights the right spot; the rest flows over the whole image.
function hiddenText(page: Doc['pages'][number], area: Area): string[] {
  const ops: string[] = [];
  const show = (lines: string[], box: Area, maxFontSize: number, spread = false) => {
    const fitted = fitText(lines, box.width, box.height, maxFontSize, spread);
    if (!fitted.lines.length) return;
    const lead = fitted.fontSize * fitted.lineHeight;
    ops.push(
      'BT', '3 Tr', `/F1 ${fitted.fontSize.toFixed(2)} Tf`, `${lead.toFixed(2)} TL`,
      `1 0 0 1 ${box.x.toFixed(2)} ${(box.y + box.height - fitted.fontSize).toFixed(2)} Tm`,
      ...fitted.lines.map((line, index) => `${index ? 'T* ' : ''}${pdfString(line)} Tj`),
      'ET',
    );
  };

  const loose: string[] = [];
  let lowest = 0; // how far down the photo the placed blocks reach (0..1)
  for (const block of page.blocks) {
    const lines = blockLines(block);
    if (!lines.length) continue;
    if (block.box) {
      const rect = boxToRect(block.box);
      lowest = Math.max(lowest, rect.y + rect.height);
      // PDF's origin is the bottom-left corner; the box is measured from the top-left.
      show(lines, {
        x: area.x + rect.x * area.width,
        y: area.y + area.height - (rect.y + rect.height) * area.height,
        width: rect.width * area.width,
        height: rect.height * area.height,
      }, 14, block.type === 'lines' || block.type === 'list');
    } else {
      loose.push(...lines);
    }
  }
  // Pages without structured blocks (older results) use their plain text.
  if (!page.blocks.length && page.text.trim()) loose.push(...page.text.split(/\n+/));
  // Blocks with no known position go in the space below the placed ones (or a thin strip at the
  // bottom), so they do not cover the rest of the page.
  if (loose.length) {
    const room = Math.max(area.height * (1 - lowest), area.height * 0.08);
    show(loose, { x: area.x, y: area.y, width: area.width, height: room }, 11);
  }
  return ops;
}

// One PDF page per document page: the page image fills the sheet, with an invisible text layer
// on top so the file can be searched and text can be selected. (We do not know word positions,
// so the hidden text follows reading order rather than lining up with each word.)
export function buildPdf(doc: Doc, now = new Date()): Uint8Array {
  if (!doc.pages.length) throw new Error('There are no pages to export.');

  // Object numbers: 1 catalog, 2 pages, 3 font, 4 info, then three per page.
  const pageId = (i: number) => 5 + i * 3;
  const objects: PdfObject[] = [];
  objects[1] = obj('<< /Type /Catalog /Pages 2 0 R >>');
  objects[2] = obj(
    `<< /Type /Pages /Kids [${doc.pages.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] /Count ${doc.pages.length} >>`,
  );
  objects[3] = obj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objects[4] = obj(`<< /Title ${pdfString(doc.name || 'Untitled document')} /Producer (helptai) /CreationDate (${pdfDate(now)}) >>`);

  doc.pages.forEach((page, i) => {
    const image = parseJpegDataUrl(page.image);
    const landscape = image.width > image.height;
    const pageWidth = landscape ? 792 : 612;
    const pageHeight = landscape ? 612 : 792;
    const box = { width: pageWidth - MARGIN * 2, height: pageHeight - MARGIN * 2 };
    const fit = fitInside(image.width, image.height, box.width, box.height);
    const x = (pageWidth - fit.width) / 2;
    const y = (pageHeight - fit.height) / 2;

    const colorSpace = image.components === 1 ? '/DeviceGray' : image.components === 4 ? '/DeviceCMYK' : '/DeviceRGB';
    const decode = image.components === 4 ? ' /Decode [1 0 1 0 1 0 1 0]' : '';

    const textOps = hiddenText(page, { x, y, width: fit.width, height: fit.height });
    const content = [
      'q', `${fit.width.toFixed(2)} 0 0 ${fit.height.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm`, '/Im0 Do', 'Q',
      ...textOps,
    ].join('\n');

    const id = pageId(i);
    objects[id] = obj(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R >> /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`,
    );
    objects[id + 1] = stream('', utf8(content));
    objects[id + 2] = stream(
      `/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace ${colorSpace} /BitsPerComponent 8 /Filter /DCTDecode${decode}`,
      image.bytes,
    );
  });

  const parts: Uint8Array[] = [utf8('%PDF-1.4\n%'), new Uint8Array([0xe2, 0xe3, 0xcf, 0xd3]), utf8('\n')];
  let offset = parts.reduce((total, part) => total + part.length, 0);
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = offset;
    const chunk = concatBytes([utf8(`${id} 0 obj\n`), objects[id], utf8('\nendobj\n')]);
    parts.push(chunk);
    offset += chunk.length;
  }
  const xref = [`xref\n0 ${objects.length}\n0000000000 65535 f \n`];
  for (let id = 1; id < objects.length; id += 1) xref.push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  xref.push(`trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 4 0 R >>\nstartxref\n${offset}\n%%EOF\n`);
  parts.push(utf8(xref.join('')));
  return concatBytes(parts);
}
