import type { Doc, Page } from '../doc-model';
import { fitInside, parseJpegDataUrl } from './jpeg';
import type { PageBlock } from '../layout';
import { pageHeading, paragraphsOf, xmlEscape } from './text';
import { zip } from './zip';

const EMU_PER_INCH = 914400;
const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const NS_WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// Brand fonts (Lora / Inter) are web fonts that most Word installs lack, so documents use
// the closest safe equivalents: Georgia for headings, Calibri for body text.
const NAVY = '2E3A46';
const AMBER_TEXT = '9A6A34';

function paragraph(text: string, options: { style?: string; italic?: boolean; color?: string; pageBreakBefore?: boolean; keepNext?: boolean; keepLines?: boolean } = {}) {
  const props = [
    options.style ? `<w:pStyle w:val="${options.style}"/>` : '',
    options.keepNext ? '<w:keepNext/>' : '',
    options.pageBreakBefore ? '<w:pageBreakBefore/>' : '',
  ].join('');
  const runProps = [options.italic ? '<w:i/>' : '', options.color ? `<w:color w:val="${options.color}"/>` : ''].join('');
  // Line breaks inside the text stay as line breaks (handwriting, code, poems).
  const runs = text
    .split('\n')
    .map((line) => `<w:r>${runProps ? `<w:rPr>${runProps}</w:rPr>` : ''}<w:t xml:space="preserve">${xmlEscape(line)}</w:t></w:r>`)
    .join(`<w:r>${runProps ? `<w:rPr>${runProps}</w:rPr>` : ''}<w:br/></w:r>`);
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${runs}</w:p>`;
}

function table(rows: string[][]) {
  const border = (side: string) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="9AA5B1"/>`;
  const columns = Math.max(...rows.map((row) => row.length));
  const cells = (row: string[]) =>
    row
      .map((cell) => `<w:tc><w:tcPr><w:tcW w:w="${Math.floor(9360 / columns)}" w:type="dxa"/></w:tcPr>${paragraph(cell, { style: 'TableText' })}</w:tc>`)
      .join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${Array.from({ length: columns }, () => `<w:gridCol w:w="${Math.floor(9360 / columns)}"/>`).join('')}</w:tblGrid>${rows.map((row) => `<w:tr>${cells(row)}</w:tr>`).join('')}</w:tbl><w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>`;
}

// A page's blocks as Word content, keeping headings, lists, tables and line breaks.
function blockParagraphs(page: Page): string[] {
  const title = page.title.trim().toLowerCase();
  const out: string[] = [];
  page.blocks.forEach((block: PageBlock, index) => {
    switch (block.type) {
      case 'heading':
        // The page heading above already carries a matching title.
        if (index === 0 && block.text.trim().toLowerCase() === title) break;
        out.push(paragraph(block.text, { style: `Heading${Math.min(4, (block.level ?? 2) + 1)}` }));
        break;
      case 'list':
        (block.items ?? []).forEach((item) => out.push(paragraph(`\u2022\t${item}`, { style: 'ListItem' })));
        break;
      case 'table':
        if (block.rows?.length) out.push(table(block.rows));
        break;
      case 'caption':
        out.push(paragraph(block.text, { style: 'CaptionText' }));
        break;
      case 'header':
      case 'footer':
        out.push(paragraph(block.text, { style: 'SmallText' }));
        break;
      case 'figure':
        break; // the page image below shows it
      default:
        if (block.text) out.push(paragraph(block.text));
    }
  });
  return out;
}

function imageParagraph(page: Page, relId: string, drawingId: number, width: number, height: number) {
  const cx = Math.round(width * EMU_PER_INCH);
  const cy = Math.round(height * EMU_PER_INCH);
  const description = xmlEscape(`Source image for page ${page.pageNumber}`);
  return `<w:p><w:pPr><w:spacing w:before="120" w:after="0"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${drawingId}" name="Page ${page.pageNumber} image" descr="${description}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="${NS_PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="${drawingId}" name="page-${page.pageNumber}.jpg"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

const STYLES = `${XML}<w:styles xmlns:w="${NS_W}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" w:eastAsia="Calibri"/><w:sz w:val="23"/><w:szCs w:val="23"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:rPr><w:color w:val="${NAVY}"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="0" w:after="60"/></w:pPr><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:cs="Georgia"/><w:b/><w:color w:val="${NAVY}"/><w:sz w:val="56"/><w:szCs w:val="56"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:color w:val="5B7FA6"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:cs="Georgia"/><w:b/><w:color w:val="${NAVY}"/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="160" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:cs="Georgia"/><w:b/><w:color w:val="${NAVY}"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="120" w:after="60"/><w:outlineLvl w:val="3"/></w:pPr><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:cs="Georgia"/><w:b/><w:color w:val="${NAVY}"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListItem"><w:name w:val="List Item"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:tabs><w:tab w:val="left" w:pos="360"/></w:tabs><w:spacing w:after="60"/><w:ind w:left="360" w:hanging="360"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="CaptionText"><w:name w:val="Caption Text"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="120"/></w:pPr><w:rPr><w:i/><w:color w:val="5B6671"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="SmallText"><w:name w:val="Small Text"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="80"/></w:pPr><w:rPr><w:color w:val="6B7782"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="Table Text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="40" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="0" w:after="160"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:cs="Georgia"/><w:b/><w:color w:val="${NAVY}"/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style>
</w:styles>`;

export function buildDocx(doc: Doc, now = new Date()): Uint8Array {
  if (!doc.pages.length) throw new Error('There are no pages to export.');
  const pages = doc.pages;
  const title = doc.name || 'Untitled document';

  const rels: string[] = [`<Relationship Id="rIdStyles" Type="${REL}/styles" Target="styles.xml"/>`];
  const media: Array<{ name: string; content: Uint8Array }> = [];
  const body: string[] = [
    paragraph(title, { style: 'Title' }),
    paragraph(`${pages.length} ${pages.length === 1 ? 'page' : 'pages'} · made with helptai`, { style: 'Subtitle' }),
  ];

  pages.forEach((page, index) => {
    const image = parseJpegDataUrl(page.image);
    const relId = `rIdImg${index + 1}`;
    media.push({ name: `word/media/page-${index + 1}.jpg`, content: image.bytes });
    rels.push(`<Relationship Id="${relId}" Type="${REL}/image" Target="media/page-${index + 1}.jpg"/>`);

    body.push(paragraph(pageHeading(page.title, page.pageNumber), { style: 'Heading1', pageBreakBefore: index > 0 }));
    if (page.status === 'needs-review') {
      body.push(paragraph(`Check this page — ${page.reviewReason ?? 'the text was hard to read from the scan.'}`, { italic: true, color: AMBER_TEXT }));
    }
    // Pages without structure (older results) fall back to their plain text.
    const content = page.blocks.length ? blockParagraphs(page) : paragraphsOf(page.text).map((line) => paragraph(line));
    if (content.length) body.push(...content);
    else body.push(paragraph('No readable text was found for this page.', { italic: true }));

    const size = fitInside(image.width, image.height, 3.2, 4.2);
    body.push(imageParagraph(page, relId, index + 1, size.width, size.height));
  });

  const documentXml = `${XML}<w:document xmlns:w="${NS_W}" xmlns:r="${NS_R}" xmlns:wp="${NS_WP}" xmlns:a="${NS_A}" xmlns:pic="${NS_PIC}"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;

  const contentTypes = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  const rootRels = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
  const documentRels = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`;
  const core = `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(title)}</dc:title><dc:creator>helptai</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now.toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`;

  return zip([
    { name: '[Content_Types].xml', content: contentTypes },
    { name: '_rels/.rels', content: rootRels },
    { name: 'docProps/core.xml', content: core },
    { name: 'word/document.xml', content: documentXml },
    { name: 'word/_rels/document.xml.rels', content: documentRels },
    { name: 'word/styles.xml', content: STYLES },
    ...media,
  ]);
}
