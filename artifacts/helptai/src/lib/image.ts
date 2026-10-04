export type PreparedImage = { dataUrl: string; width: number; height: number };

// The size an image should be scaled to so its longer side is at most `maxEdge`.
export function fitLongEdge(width: number, height: number, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// Turns a photo (a file, a camera capture, or a data URL) into a JPEG of a sensible size. Exports
// need JPEG, and phone photos are far larger than the AI needs, so this also keeps uploads small.
export async function prepareImage(source: Blob | string, maxEdge = 1400, quality = 0.85): Promise<PreparedImage> {
  const blob = typeof source === 'string' ? await (await fetch(source)).blob() : source;
  // "from-image" applies the photo's rotation (EXIF), so portrait phone photos are not sideways.
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  try {
    const { width, height } = fitLongEdge(bitmap.width, bitmap.height, maxEdge);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser could not prepare the photo.');
    context.fillStyle = '#ffffff'; // JPEG has no transparency
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    return { dataUrl: canvas.toDataURL('image/jpeg', quality), width, height };
  } finally {
    bitmap.close();
  }
}
