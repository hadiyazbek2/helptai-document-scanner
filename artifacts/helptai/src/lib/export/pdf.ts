import type { Doc } from '../doc-model';
import { concatBytes, utf8 } from './bytes';
import { fitInside, parseJpegDataUrl } from './jpeg';
import { pdfString, wrapText } from './text';

const MARGIN = 28;

function pdfDate(date: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `D:${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`;
}

type PdfObject = Uint8Array;

const obj = (dictionary: string): PdfObject => utf8(dictionary);
const stream = (dictionary: string, data: Uint8Array): PdfObject =>
  concatBytes([utf8(`<< ${dictionary} /Length ${data.length} >>\nstream\n`), data, utf8('\nendstream')]);

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

    // Pick the largest hidden-text size that fits inside the image area.
    let fontSize = 11;
    let lines = wrapText(page.text, Math.floor(fit.width / (fontSize * 0.5)));
    while (fontSize > 5 && lines.length * fontSize * 1.2 > fit.height) {
      fontSize -= 1;
      lines = wrapText(page.text, Math.floor(fit.width / (fontSize * 0.5)));
    }
    const lead = fontSize * 1.2;
    const textOps = lines.length
      ? [
          'BT', '3 Tr', `/F1 ${fontSize} Tf`, `${lead.toFixed(2)} TL`,
          `${x.toFixed(2)} ${(y + fit.height - fontSize).toFixed(2)} Td`,
          ...lines.map((line, index) => `${index ? 'T* ' : ''}${pdfString(line)} Tj`),
          'ET',
        ]
      : [];
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
