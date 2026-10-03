import type { Doc, Page } from '../doc-model';
import { fitInside, parseJpegDataUrl } from './jpeg';
import { displayTitle, paragraphsOf, xmlEscape } from './text';
import { zip, type ZipEntry } from './zip';

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

// 16:9 slide, in EMU (914400 per inch).
const SLIDE = { width: 12192000, height: 6858000 };
const MARGIN = 457200;
const IMAGE_BOX = { x: MARGIN, y: 1000000, width: 4600000, height: 5300000 };
const TEXT_BOX = { x: 5350000, y: 1000000, width: SLIDE.width - 5350000 - MARGIN, height: 5300000 };

const NAVY = '2E3A46';
const AMBER_TEXT = '9A6A34';
// Georgia / Calibri stand in for the brand's Lora / Inter, which most machines lack.
const HEADING_FONT = 'Georgia';
const BODY_FONT = 'Calibri';

function run(text: string, size: number, options: { bold?: boolean; italic?: boolean; color?: string; font?: string } = {}) {
  return `<a:r><a:rPr lang="en-US" sz="${size}"${options.bold ? ' b="1"' : ''}${options.italic ? ' i="1"' : ''} dirty="0"><a:solidFill><a:srgbClr val="${options.color ?? NAVY}"/></a:solidFill><a:latin typeface="${options.font ?? BODY_FONT}"/></a:rPr><a:t>${xmlEscape(text)}</a:t></a:r>`;
}

function textShape(id: number, name: string, box: { x: number; y: number; width: number; height: number }, paragraphs: string[], anchor = 't') {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${box.x}" y="${box.y}"/><a:ext cx="${box.width}" cy="${box.height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="${anchor}"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paragraphs.join('')}</p:txBody></p:sp>`;
}

const para = (runs: string, afterPts = 0, align = 'l') =>
  `<a:p><a:pPr algn="${align}">${afterPts ? `<a:spcAft><a:spcPts val="${afterPts}"/></a:spcAft>` : ''}</a:pPr>${runs}</a:p>`;

// Longer pages get smaller type so the text stays inside the slide.
function bodySize(characters: number) {
  if (characters <= 500) return 1600;
  if (characters <= 900) return 1400;
  if (characters <= 1400) return 1200;
  if (characters <= 2000) return 1050;
  if (characters <= 2800) return 900;
  return 800;
}

function slideXml(page: Page, index: number, total: number, image: { width: number; height: number }) {
  const fit = fitInside(image.width, image.height, IMAGE_BOX.width, IMAGE_BOX.height);
  const cx = Math.round(fit.width);
  const cy = Math.round(fit.height);
  const x = IMAGE_BOX.x + Math.round((IMAGE_BOX.width - cx) / 2);
  const y = IMAGE_BOX.y + Math.round((IMAGE_BOX.height - cy) / 2);

  const lines = paragraphsOf(page.text);
  const size = bodySize(page.text.length);
  const bodyParagraphs = lines.length
    ? lines.map((line) => para(run(line, size), 600))
    : [para(run('No readable text was found for this page.', 1400, { italic: true }))];

  const flag = page.status === 'needs-review'
    ? [para(run(`Check this page — ${page.reviewReason ?? 'the text was hard to read from the scan.'}`, 1100, { italic: true, color: AMBER_TEXT }), 600)]
    : [];

  const title = textShape(2, 'Title', { x: MARGIN, y: 330000, width: SLIDE.width - MARGIN * 2, height: 560000 },
    [para(run(displayTitle(page.title, page.pageNumber), 2400, { bold: true, font: HEADING_FONT }))], 'ctr');
  const text = textShape(3, 'Text', TEXT_BOX, [...flag, ...bodyParagraphs]);
  const picture = `<p:pic><p:nvPicPr><p:cNvPr id="4" name="Page ${page.pageNumber} image" descr="${xmlEscape(`Source image for page ${page.pageNumber}`)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
  const footer = textShape(5, 'Footer', { x: MARGIN, y: 6450000, width: SLIDE.width - MARGIN * 2, height: 250000 },
    [para(run(`helptai · page ${index + 1} of ${total}`, 1000, { color: '6B7782' }), 0, 'r')], 'ctr');

  return `${XML}<p:sld ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="F7F3EC"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${title}${picture}${text}${footer}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

const relationships = (items: string[]) => `${XML}<Relationships xmlns="${RELS_NS}">${items.join('')}</Relationships>`;
const rel = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`;
const EMPTY_TREE = '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>';

const LEVEL1 = (size: number) => `<a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="${size}" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr>`;

const master = `${XML}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>${EMPTY_TREE}</p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle>${LEVEL1(2400)}</p:titleStyle><p:bodyStyle>${LEVEL1(1600)}</p:bodyStyle><p:otherStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr>${LEVEL1(1800)}</p:otherStyle></p:txStyles></p:sldMaster>`;

const layout = `${XML}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank">${EMPTY_TREE}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

const FILL = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
const LINE = '<a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>';
const theme = `${XML}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="helptai"><a:themeElements><a:clrScheme name="helptai"><a:dk1><a:srgbClr val="${NAVY}"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="${NAVY}"/></a:dk2><a:lt2><a:srgbClr val="F7F3EC"/></a:lt2><a:accent1><a:srgbClr val="5B7FA6"/></a:accent1><a:accent2><a:srgbClr val="8CAA82"/></a:accent2><a:accent3><a:srgbClr val="D99A5B"/></a:accent3><a:accent4><a:srgbClr val="${NAVY}"/></a:accent4><a:accent5><a:srgbClr val="5B7FA6"/></a:accent5><a:accent6><a:srgbClr val="D99A5B"/></a:accent6><a:hlink><a:srgbClr val="5B7FA6"/></a:hlink><a:folHlink><a:srgbClr val="D99A5B"/></a:folHlink></a:clrScheme><a:fontScheme name="helptai"><a:majorFont><a:latin typeface="${HEADING_FONT}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="${BODY_FONT}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="helptai"><a:fillStyleLst>${FILL}${FILL}${FILL}</a:fillStyleLst><a:lnStyleLst>${LINE}${LINE}${LINE}</a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst>${FILL}${FILL}${FILL}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

export function buildPptx(doc: Doc, now = new Date()): Uint8Array {
  if (!doc.pages.length) throw new Error('There are no pages to export.');
  const pages = doc.pages;
  const title = doc.name || 'Untitled document';

  const entries: ZipEntry[] = [];
  const slideOverrides: string[] = [];
  const slideIds: string[] = [];
  const presentationRels = [rel('rId1', 'slideMaster', 'slideMasters/slideMaster1.xml')];

  pages.forEach((page, index) => {
    const n = index + 1;
    const image = parseJpegDataUrl(page.image);
    entries.push(
      { name: `ppt/slides/slide${n}.xml`, content: slideXml(page, index, pages.length, image) },
      { name: `ppt/slides/_rels/slide${n}.xml.rels`, content: relationships([rel('rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'), rel('rId2', 'image', `../media/page-${n}.jpg`)]) },
      { name: `ppt/media/page-${n}.jpg`, content: image.bytes },
    );
    slideOverrides.push(`<Override PartName="/ppt/slides/slide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`);
    slideIds.push(`<p:sldId id="${255 + n}" r:id="rId${n + 1}"/>`);
    presentationRels.push(rel(`rId${n + 1}`, 'slide', `slides/slide${n}.xml`));
  });
  presentationRels.push(rel(`rId${pages.length + 2}`, 'theme', 'theme/theme1.xml'));

  const contentTypes = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>${slideOverrides.join('')}<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  const presentation = `${XML}<p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slideIds.join('')}</p:sldIdLst><p:sldSz cx="${SLIDE.width}" cy="${SLIDE.height}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle>${LEVEL1(1800)}</p:defaultTextStyle></p:presentation>`;
  const core = `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(title)}</dc:title><dc:creator>helptai</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now.toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`;

  return zip([
    { name: '[Content_Types].xml', content: contentTypes },
    { name: '_rels/.rels', content: relationships([rel('rId1', 'officeDocument', 'ppt/presentation.xml'), `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>`]) },
    { name: 'docProps/core.xml', content: core },
    { name: 'ppt/presentation.xml', content: presentation },
    { name: 'ppt/_rels/presentation.xml.rels', content: relationships(presentationRels) },
    { name: 'ppt/slideMasters/slideMaster1.xml', content: master },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', content: relationships([rel('rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'), rel('rId2', 'theme', '../theme/theme1.xml')]) },
    { name: 'ppt/slideLayouts/slideLayout1.xml', content: layout },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', content: relationships([rel('rId1', 'slideMaster', '../slideMasters/slideMaster1.xml')]) },
    { name: 'ppt/theme/theme1.xml', content: theme },
    ...entries,
  ]);
}
