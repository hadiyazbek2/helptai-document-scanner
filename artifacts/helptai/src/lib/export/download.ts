import { safeFileName } from './bytes';
import { buildDocx } from './docx';
import { buildPdf } from './pdf';
import { buildPptx } from './pptx';
import type { Doc } from '../doc-model';

function download(bytes: Uint8Array, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const downloadPdf = (doc: Doc) => download(buildPdf(doc), `${safeFileName(doc.name)}.pdf`, 'application/pdf');
export const downloadDocx = (doc: Doc) =>
  download(buildDocx(doc), `${safeFileName(doc.name)}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
export const downloadPptx = (doc: Doc) =>
  download(buildPptx(doc), `${safeFileName(doc.name)}.pptx`, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
