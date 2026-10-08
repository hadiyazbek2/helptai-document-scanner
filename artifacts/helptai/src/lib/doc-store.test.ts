import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import type { Doc, Page } from './doc-model';
import { blobToDataUrl, closeStore, dataUrlToBlob, deleteDoc, listDocs, loadDoc, removeVideo, renameDoc, saveDoc } from './doc-store';

const jpeg = (byte: number) => `data:image/jpeg;base64,${btoa(String.fromCharCode(0xff, 0xd8, byte, byte, 0xff, 0xd9))}`;
const page = (pageNumber: number, extra: Partial<Page> = {}): Page => ({
  id: `page-${pageNumber}`, pageNumber, title: `Page ${pageNumber}`, text: `text ${pageNumber}`, confidence: 0.9,
  status: 'ok', reviewReason: null, image: jpeg(pageNumber), imageSize: { width: 10, height: 20 }, blocks: [],
  pageBox: null, sourceFrameIndices: [pageNumber - 1], bestFrameIndex: pageNumber - 1,
  video: { from: pageNumber, to: pageNumber + 1, at: pageNumber + 0.5 }, retakes: 0, ...extra,
});
const doc = (id: string, pages: Page[], extra: Partial<Doc> = {}): Doc => ({
  id, name: `Doc ${id}`, createdAt: 1000, updatedAt: 2000, pages,
  selectedFrameCount: pages.length, discardedFrameCount: 0, processingNote: '', ...extra,
});
const noThumb = { makeThumb: async () => null };

afterEach(async () => {
  await closeStore();
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase('helptai');
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
});

describe('doc-store', () => {
  it('converts images between data URLs and Blobs without changing them', async () => {
    const url = jpeg(7);
    expect(await blobToDataUrl(dataUrlToBlob(url))).toBe(url);
  });

  it('saves a document and loads it back exactly, with its video', async () => {
    const original = doc('a', [page(1), page(2, { status: 'needs-review', reviewReason: 'Hand' })]);
    const video = new Blob([new Uint8Array(50)], { type: 'video/mp4' });
    expect(await saveDoc(original, { ...noThumb, video, videoName: 'notes.mp4' })).toEqual({ videoKept: true });
    const loaded = await loadDoc('a');
    expect(loaded?.doc).toEqual(original);
    expect(loaded?.video?.name).toBe('notes.mp4');
    expect(loaded?.video?.size).toBe(50);
    expect(await loadDoc('missing')).toBeNull();
  });

  it('lists documents newest first, with counts for the home screen', async () => {
    await saveDoc(doc('old', [page(1)], { updatedAt: 1 }), noThumb);
    await saveDoc(doc('new', [page(1), page(2, { status: 'needs-review' })], { updatedAt: 5 }), { makeThumb: async () => new Blob(['t'], { type: 'image/jpeg' }) });
    const list = await listDocs();
    expect(list.map((d) => d.id)).toEqual(['new', 'old']);
    expect(list[0]).toMatchObject({ pageCount: 2, flaggedCount: 1, hasVideo: false });
    expect(list[0].thumb).toMatch(/^data:image\/jpeg;base64,/);
    expect(list[1].thumb).toBeNull();
  });

  it('replaces the page set on a later save, and keeps the video unless told otherwise', async () => {
    await saveDoc(doc('a', [page(1), page(2), page(3)]), { ...noThumb, video: new Blob(['v'], { type: 'video/mp4' }) });
    await saveDoc(doc('a', [page(1, { text: 'fixed' })]), noThumb);
    const loaded = await loadDoc('a');
    expect(loaded?.doc.pages.map((p) => p.text)).toEqual(['fixed']);
    expect(loaded?.video).not.toBeNull();
    await saveDoc(doc('a', [page(1)]), { ...noThumb, video: null });
    expect((await loadDoc('a'))?.video).toBeNull();
  });

  it('renames, removes a video on its own, and deletes everything of a document', async () => {
    await saveDoc(doc('a', [page(1)]), { ...noThumb, video: new Blob([new Uint8Array(1000)], { type: 'video/mp4' }) });
    await saveDoc(doc('b', [page(1)]), noThumb);
    await renameDoc('a', 'Chemistry notes');
    expect((await loadDoc('a'))?.doc.name).toBe('Chemistry notes');

    const before = (await listDocs()).find((d) => d.id === 'a');
    await removeVideo('a');
    const after = (await listDocs()).find((d) => d.id === 'a');
    expect(after?.hasVideo).toBe(false);
    expect(after!.bytes).toBe(before!.bytes - 1000);
    expect((await loadDoc('a'))?.doc.pages).toHaveLength(1);

    await deleteDoc('a');
    expect(await loadDoc('a')).toBeNull();
    expect((await listDocs()).map((d) => d.id)).toEqual(['b']);
  });
});
