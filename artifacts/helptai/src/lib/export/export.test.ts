import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import type { Doc, Page } from '../doc-model';
import { buildDocx } from './docx';
import { GRAY, LANDSCAPE, PORTRAIT } from './fixtures';
import { readJpegSize } from './jpeg';
import { buildPdf } from './pdf';
import { buildPptx } from './pptx';
import { pdfString, toWinAnsiBytes, wrapText } from './text';
import type { PageBlock } from '../layout';

const NOW = new Date('2026-10-03T12:00:00Z');
const latin1 = (bytes: Uint8Array) => Array.from(bytes, (b) => String.fromCharCode(b)).join('');

function page(n: number, extra: Partial<Page> = {}): Page {
  return {
    id: `page-${n}`, pageNumber: n, title: `Title ${n}`, text: `Text of page ${n}.\nSecond paragraph ${n}.`,
    confidence: 0.9, status: 'ok', reviewReason: null, image: PORTRAIT.dataUrl, imageSize: { width: 90, height: 120 }, blocks: [], pageBox: null, sourceFrameIndices: [0], bestFrameIndex: 0, ...extra,
  };
}
const makeDoc = (pages: Page[], name = 'My notes'): Doc => ({ name, pages, selectedFrameCount: pages.length, discardedFrameCount: 0, processingNote: '' });

// Minimal reader for the "store" zips we write.
function unzip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (view.getUint32(end, true) !== 0x06054b50) end -= 1;
  const count = view.getUint16(end + 10, true);
  let p = view.getUint32(end + 16, true);
  const files = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i += 1) {
    const size = view.getUint32(p + 24, true);
    const nameLength = view.getUint16(p + 28, true);
    const extra = view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLength));
    const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    files.set(name, bytes.slice(start, start + size));
    p += 46 + nameLength + extra;
  }
  return files;
}
const textOf = (files: Map<string, Uint8Array>, name: string) => new TextDecoder().decode(files.get(name));

function assertWellFormed(files: Map<string, Uint8Array>) {
  for (const [name, content] of files) {
    if (!/\.(xml|rels)$/.test(name)) continue;
    const errors: string[] = [];
    new DOMParser({ onError: (_level: string, message: string) => errors.push(message) }).parseFromString(new TextDecoder().decode(content), 'text/xml');
    expect(errors, name).toEqual([]);
  }
}

describe('text helpers', () => {
  it('maps typographic and accented characters to WinAnsi and falls back for symbols', () => {
    expect(toWinAnsiBytes('é')).toEqual([0xe9]);
    expect(toWinAnsiBytes('“a”')).toEqual([0x93, 0x61, 0x94]);
    expect(String.fromCharCode(...toWinAnsiBytes('a → b'))).toBe('a -> b');
    expect(String.fromCharCode(...toWinAnsiBytes('ms⁻¹'))).toBe('ms-\xb9');
    expect(String.fromCharCode(...toWinAnsiBytes('∃x ⊨ λ'))).toBe('existsx |= lambda');
    expect(String.fromCharCode(...toWinAnsiBytes('日'))).toBe('?');
  });
  it('escapes PDF string delimiters', () => {
    expect(pdfString('a(b)c\\d')).toBe('(a\\(b\\)c\\\\d)');
    expect(pdfString('é')).toBe('(\\351)');
  });
  it('wraps words and splits over-long words', () => {
    expect(wrapText('aaa bbb ccc', 7)).toEqual(['aaa bbb', 'ccc']);
    expect(wrapText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
    expect(wrapText('one\n\ntwo', 20)).toEqual(['one', 'two']);
  });
  it('reads JPEG sizes', () => {
    const b64 = (s: string) => Uint8Array.from(atob(s.split(',')[1]), (c) => c.charCodeAt(0));
    expect(readJpegSize(b64(PORTRAIT.dataUrl))).toMatchObject({ width: 90, height: 120, components: 3 });
    expect(readJpegSize(b64(GRAY.dataUrl))).toMatchObject({ width: 64, height: 64, components: 1 });
  });
});

describe('buildPdf', () => {
  const doc = makeDoc([
    page(1, { text: 'Hello (world) \\ “quoted” café → done' }),
    page(2, { image: LANDSCAPE.dataUrl }),
    page(3, { image: GRAY.dataUrl, text: '' }),
  ]);
  const bytes = buildPdf(doc, NOW);
  const raw = latin1(bytes);

  it('is a structurally valid PDF with correct xref offsets', () => {
    expect(raw.startsWith('%PDF-1.4')).toBe(true);
    expect(raw.trimEnd().endsWith('%%EOF')).toBe(true);
    const xrefAt = Number(/startxref\n(\d+)/.exec(raw)![1]);
    expect(raw.slice(xrefAt, xrefAt + 4)).toBe('xref');
    const entries = [...raw.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)];
    expect(entries.length).toBeGreaterThan(5);
    entries.forEach((entry, i) => {
      expect(raw.slice(Number(entry[1]), Number(entry[1]) + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });
  });

  it('has one page per document page, sized to the image orientation', () => {
    expect(raw.match(/\/Type \/Page /g)).toHaveLength(3);
    expect(raw).toContain('/Count 3');
    expect(raw.match(/\/MediaBox \[0 0 612 792\]/g)).toHaveLength(2);
    expect(raw.match(/\/MediaBox \[0 0 792 612\]/g)).toHaveLength(1);
  });

  it('embeds each image as JPEG with its true size and colour space', () => {
    expect(raw).toContain('/Width 90 /Height 120 /ColorSpace /DeviceRGB');
    expect(raw).toContain('/Width 120 /Height 90 /ColorSpace /DeviceRGB');
    expect(raw).toContain('/Width 64 /Height 64 /ColorSpace /DeviceGray');
    expect(raw.match(/\/Filter \/DCTDecode/g)).toHaveLength(3);
  });

  it('adds an invisible, correctly escaped text layer', () => {
    expect(raw).toContain('3 Tr');
    expect(raw).toContain('Hello \\(world\\) \\\\ \\223quoted\\224 caf\\351 -> done');
    expect(raw).toContain('Text of page 2.');
  });

  it('records the title and refuses an empty document', () => {
    expect(raw).toContain('/Title (My notes)');
    expect(raw).toContain('D:20261003120000Z');
    expect(() => buildPdf(makeDoc([]))).toThrow();
  });
});

describe('buildDocx', () => {
  const doc = makeDoc([
    page(1, { text: 'Fish & chips <b>\n“Quoted”' }),
    page(2, { status: 'needs-review', reviewReason: 'A hand covers the corner.', title: 'Untitled page' }),
    page(3, { text: '' }),
  ], 'Notes & ideas');
  const files = unzip(buildDocx(doc, NOW));
  const documentXml = textOf(files, 'word/document.xml');

  it('contains every part Word needs, all well-formed', () => {
    ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/_rels/document.xml.rels', 'word/styles.xml', 'docProps/core.xml'].forEach((name) => expect(files.has(name), name).toBe(true));
    assertWellFormed(files);
  });

  it('writes the real text, escaped, with a title and heading per page', () => {
    expect(documentXml).toContain('Notes &amp; ideas');
    expect(documentXml).toContain('Fish &amp; chips &lt;b&gt;');
    expect(documentXml).toContain('“Quoted”');
    expect(documentXml).toContain('Page 1 \u2014 Title 1');
    expect(documentXml).toContain('>Page 2<'); // "Untitled page" becomes just the page number
    expect(documentXml).toContain('No readable text was found for this page.');
    expect(documentXml).not.toContain('12 pages');
  });

  it('breaks pages, flags review pages calmly, and embeds one image per page', () => {
    expect(documentXml.match(/<w:pageBreakBefore\/>/g)).toHaveLength(2);
    expect(documentXml).toContain('Check this page — A hand covers the corner.');
    expect(documentXml.match(/<w:drawing>/g)).toHaveLength(3);
    expect([...files.keys()].filter((name) => name.startsWith('word/media/'))).toHaveLength(3);
  });

  it('resolves every image relationship', () => {
    const rels = textOf(files, 'word/_rels/document.xml.rels');
    for (const [, id] of documentXml.matchAll(/r:embed="([^"]+)"/g)) expect(rels).toContain(`Id="${id}"`);
    for (const [, target] of rels.matchAll(/Target="media\/([^"]+)"/g)) expect(files.has(`word/media/${target}`)).toBe(true);
  });
});

describe('buildPptx', () => {
  const doc = makeDoc([page(1), page(2, { image: LANDSCAPE.dataUrl, status: 'needs-review', reviewReason: 'Blurry.' }), page(3, { text: 'x'.repeat(4000) })]);
  const files = unzip(buildPptx(doc, NOW));

  it('has well-formed parts and one slide per page', () => {
    assertWellFormed(files);
    expect([...files.keys()].filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))).toHaveLength(3);
    const presentation = textOf(files, 'ppt/presentation.xml');
    expect(presentation.match(/<p:sldId /g)).toHaveLength(3);
  });

  it('registers every slide and the jpeg type, and resolves slide images', () => {
    const types = textOf(files, '[Content_Types].xml');
    for (let n = 1; n <= 3; n += 1) {
      expect(types).toContain(`/ppt/slides/slide${n}.xml`);
      expect(textOf(files, `ppt/slides/_rels/slide${n}.xml.rels`)).toContain(`../media/page-${n}.jpg`);
      expect(files.has(`ppt/media/page-${n}.jpg`)).toBe(true);
    }
    expect(types).toContain('Extension="jpg"');
  });

  it('puts the real text and review note on the slides', () => {
    expect(textOf(files, 'ppt/slides/slide1.xml')).toContain('Text of page 1.');
    expect(textOf(files, 'ppt/slides/slide2.xml')).toContain('Check this page — Blurry.');
    expect(textOf(files, 'ppt/slides/slide1.xml')).toContain('page 1 of 3');
  });

  it('ships a complete theme (PowerPoint rejects empty format lists)', () => {
    const theme = textOf(files, 'ppt/theme/theme1.xml');
    expect(theme.match(/<a:solidFill><a:schemeClr val="phClr"\/><\/a:solidFill>/g)!.length).toBeGreaterThanOrEqual(6);
    expect(theme.match(/<a:effectStyle>/g)).toHaveLength(3);
    expect(theme.match(/<a:ln /g)).toHaveLength(3);
  });
});


const structured: PageBlock[] = [
  { type: 'heading', level: 1, text: 'Title 1', box: [20, 50, 80, 700] },
  { type: 'paragraph', text: 'Intro paragraph.', box: [100, 50, 220, 950] },
  { type: 'heading', level: 2, text: 'Subsection', box: [240, 50, 290, 600] },
  { type: 'list', text: '', items: ['first item', 'second item'], box: [300, 50, 420, 700] },
  { type: 'table', text: '', rows: [['Medium', 'Speed'], ['Air', '340']], box: [440, 50, 560, 900] },
  { type: 'lines', text: 'line one\nline two', box: [580, 50, 680, 800] },
  { type: 'caption', text: 'Figure 1. A caption', box: [700, 50, 740, 800] },
  { type: 'figure', text: '', box: [750, 50, 950, 950] },
];
const structuredDoc = makeDoc([page(1, { blocks: structured, text: 'ignored when blocks exist' })]);

describe('structured pages (layout kept)', () => {
  it('Word keeps headings, lists, tables, line breaks and captions', () => {
    const files = unzip(buildDocx(structuredDoc, NOW));
    assertWellFormed(files);
    const xml = textOf(files, 'word/document.xml');
    expect(xml).toContain('w:val="Heading3"'); // level 2 block heading
    expect(xml).toContain('\u2022\tfirst item');
    expect(xml).toContain('w:val="ListItem"');
    expect(xml).toContain('<w:tbl>');
    expect(xml.match(/<w:tr>/g)).toHaveLength(2);
    expect(xml).toContain('>340<');
    expect(xml).toContain('<w:br/>'); // "lines" block keeps its line break
    expect(xml).toContain('w:val="CaptionText"');
    expect(xml).not.toContain('ignored when blocks exist');
    // The first heading repeats the page title already shown in the page heading.
    expect(xml.match(/Title 1/g)).toHaveLength(1);
  });

  it('PowerPoint uses bullets and bold headings', () => {
    const files = unzip(buildPptx(structuredDoc, NOW));
    assertWellFormed(files);
    const xml = textOf(files, 'ppt/slides/slide1.xml');
    expect(xml.match(/<a:buChar /g)).toHaveLength(2);
    expect(xml).toContain('first item');
    expect(xml).toContain('Subsection');
    expect(xml).toContain('b="1"');
    expect(xml).not.toContain('ignored when blocks exist');
  });

  it('PDF places each block\'s hidden text at its own position', () => {
    const raw = latin1(buildPdf(structuredDoc, NOW));
    // One text object per placed block (figure has no text), each with its own matrix.
    expect(raw.match(/ Tm\n/g)!.length).toBe(7);
    const positions = [...raw.matchAll(/1 0 0 1 ([\d.]+) ([\d.]+) Tm/g)].map((m) => Number(m[2]));
    // Blocks lower on the photo sit lower on the page (smaller y in PDF space).
    expect(positions[1]).toBeLessThan(positions[0]);
    expect(positions[6]).toBeLessThan(positions[1]);
    expect(raw).toContain('first item');
    expect(raw).toContain('Intro paragraph.');
  });
});
