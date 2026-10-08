import type { Doc, Page } from './doc-model';

// Keeps documents on this device (IndexedDB), so a refresh or a closed tab loses nothing.
//
// Three stores:
//  - docs:   one record per document: its name, dates, counts and a small thumbnail, for the
//            home screen list, plus the document's own fields (everything but the pages);
//  - pages:  one record per page, with the page image as a Blob (a third smaller than a data URL);
//  - videos: the capture video, kept so "choose another frame" still works after reopening. Videos
//            are big, so they are stored separately, can be removed on their own, and a document
//            is still saved when there is no room for its video.
// Records carry a schema version so the format can change, and later sync to an account, without
// losing what people have saved.

const DB_NAME = 'helptai';
const DB_VERSION = 1;
const SCHEMA = 1;

export type DocSummary = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  pageCount: number;
  flaggedCount: number;
  // A small JPEG of the first page as a data URL, or null.
  thumb: string | null;
  hasVideo: boolean;
  // Bytes used by the pages and the video, roughly.
  bytes: number;
};

type DocRecord = Omit<DocSummary, 'thumb'> & {
  schema: number;
  thumb: Blob | null;
  doc: Omit<Doc, 'pages'>;
};
type PageRecord = { docId: string; pageNumber: number; page: Omit<Page, 'image'>; image: Blob };
type VideoRecord = { docId: string; blob: Blob; name: string; type: string };

let opening: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser cannot keep documents on the device.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('pages')) {
        db.createObjectStore('pages', { keyPath: ['docId', 'pageNumber'] }).createIndex('docId', 'docId');
      }
      if (!db.objectStoreNames.contains('videos')) db.createObjectStore('videos', { keyPath: 'docId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('The document store could not be opened.'));
  }).catch((error) => {
    opening = null;
    throw error;
  });
  return opening;
}

// For tests: forget the open connection (after the database was deleted).
export async function closeStore() {
  if (!opening) return;
  const db = await opening.catch(() => null);
  db?.close();
  opening = null;
}

function done(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new DOMException('Aborted', 'AbortError'));
  });
}

function result<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function isQuotaError(error: unknown) {
  return error instanceof DOMException && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED');
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) throw new Error('Not a data URL.');
  const type = match[1] ?? 'application/octet-stream';
  if (!match[2]) return new Blob([decodeURIComponent(match[3])], { type });
  const binary = atob(match[3]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
}

export type SaveOptions = {
  // The capture video: a Blob to keep it, null to remove a kept one, undefined to leave it as is.
  video?: Blob | null;
  videoName?: string;
  // Makes the home-screen thumbnail from the first page's image (the browser version scales it
  // down with a canvas; tests pass their own).
  makeThumb?: (dataUrl: string) => Promise<Blob | null>;
};

// Saves (or replaces) a whole document. Returns whether the video is kept: when the device has no
// room for it, the document is still saved, without the video.
export async function saveDoc(doc: Doc, options: SaveOptions = {}): Promise<{ videoKept: boolean }> {
  const db = await openDb();
  const pages: PageRecord[] = doc.pages.map(({ image, ...page }) => ({
    docId: doc.id,
    pageNumber: page.pageNumber,
    page,
    image: dataUrlToBlob(image),
  }));
  const makeThumb = options.makeThumb ?? browserThumb;
  const thumb = doc.pages[0] ? await makeThumb(doc.pages[0].image).catch(() => null) : null;
  const previous = await getDocRecord(doc.id);

  // The video first, in its own transaction, so running out of room only loses the video.
  let hasVideo = previous?.hasVideo ?? false;
  let videoBytes = hasVideo ? (await result(db.transaction('videos').objectStore('videos').get(doc.id)) as VideoRecord | undefined)?.blob.size ?? 0 : 0;
  if (options.video !== undefined) {
    const tx = db.transaction('videos', 'readwrite');
    if (options.video === null) tx.objectStore('videos').delete(doc.id);
    else tx.objectStore('videos').put({ docId: doc.id, blob: options.video, name: options.videoName ?? 'capture', type: options.video.type } satisfies VideoRecord);
    try {
      await done(tx);
      hasVideo = options.video !== null;
      videoBytes = options.video?.size ?? 0;
    } catch (error) {
      if (!isQuotaError(error)) throw error;
      hasVideo = false;
      videoBytes = 0;
    }
  }

  const { pages: _pages, ...fields } = doc;
  const record: DocRecord = {
    schema: SCHEMA,
    id: doc.id,
    name: doc.name,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    pageCount: doc.pages.length,
    flaggedCount: doc.pages.filter((page) => page.status === 'needs-review').length,
    thumb,
    hasVideo,
    bytes: pages.reduce((n, page) => n + page.image.size, 0) + videoBytes,
    doc: fields,
  };
  const tx = db.transaction(['docs', 'pages'], 'readwrite');
  const pageStore = tx.objectStore('pages');
  // Replace the page set: a document can lose pages (deleted, merged) between saves.
  pageStore.delete(IDBKeyRange.bound([doc.id, -Infinity], [doc.id, Infinity]));
  for (const page of pages) pageStore.put(page);
  tx.objectStore('docs').put(record);
  await done(tx);
  return { videoKept: hasVideo };
}

function getDocRecord(id: string) {
  return openDb().then((db) => result(db.transaction('docs').objectStore('docs').get(id)) as Promise<DocRecord | undefined>);
}

// Newest first.
export async function listDocs(): Promise<DocSummary[]> {
  const db = await openDb();
  const records = (await result(db.transaction('docs').objectStore('docs').getAll())) as DocRecord[];
  const summaries = await Promise.all(
    records.map(async ({ schema: _schema, doc: _doc, thumb, ...summary }) => ({
      ...summary,
      thumb: thumb ? await blobToDataUrl(thumb) : null,
    })),
  );
  return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadDoc(id: string): Promise<{ doc: Doc; video: File | null } | null> {
  const db = await openDb();
  const tx = db.transaction(['docs', 'pages', 'videos']);
  const [record, pageRecords, video] = await Promise.all([
    result(tx.objectStore('docs').get(id)) as Promise<DocRecord | undefined>,
    result(tx.objectStore('pages').index('docId').getAll(id)) as Promise<PageRecord[]>,
    result(tx.objectStore('videos').get(id)) as Promise<VideoRecord | undefined>,
  ]);
  if (!record) return null;
  const pages: Page[] = await Promise.all(
    pageRecords
      .sort((a, b) => a.pageNumber - b.pageNumber)
      .map(async ({ page, image }) => ({ ...page, image: await blobToDataUrl(image) })),
  );
  return {
    doc: { ...record.doc, name: record.name, updatedAt: record.updatedAt, pages },
    video: video ? new File([video.blob], video.name, { type: video.type }) : null,
  };
}

export async function renameDoc(id: string, name: string) {
  const db = await openDb();
  const tx = db.transaction('docs', 'readwrite');
  const store = tx.objectStore('docs');
  const record = (await result(store.get(id))) as DocRecord | undefined;
  if (record) {
    const updatedAt = Date.now();
    store.put({ ...record, name, updatedAt, doc: { ...record.doc, name, updatedAt } });
  }
  await done(tx);
}

export async function deleteDoc(id: string) {
  const db = await openDb();
  const tx = db.transaction(['docs', 'pages', 'videos'], 'readwrite');
  tx.objectStore('docs').delete(id);
  tx.objectStore('pages').delete(IDBKeyRange.bound([id, -Infinity], [id, Infinity]));
  tx.objectStore('videos').delete(id);
  await done(tx);
}

// Frees the space a document's video takes; the document and its pages stay.
export async function removeVideo(id: string) {
  const db = await openDb();
  const tx = db.transaction(['docs', 'videos'], 'readwrite');
  const docs = tx.objectStore('docs');
  const record = (await result(docs.get(id))) as DocRecord | undefined;
  const video = (await result(tx.objectStore('videos').get(id))) as VideoRecord | undefined;
  tx.objectStore('videos').delete(id);
  if (record) docs.put({ ...record, hasVideo: false, bytes: Math.max(0, record.bytes - (video?.blob.size ?? 0)) });
  await done(tx);
}

// Asks the browser not to clear our storage when space runs low (it may decline; that is fine).
export async function askToKeepStorage() {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

// A 240 px JPEG of the first page, for the home screen list.
async function browserThumb(dataUrl: string): Promise<Blob | null> {
  if (typeof document === 'undefined' || typeof createImageBitmap === 'undefined') return null;
  const bitmap = await createImageBitmap(dataUrlToBlob(dataUrl));
  try {
    const scale = Math.min(1, 240 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.7));
  } finally {
    bitmap.close();
  }
}
