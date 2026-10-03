export type JpegImage = { bytes: Uint8Array; width: number; height: number; components: number };

// Reads a JPEG data URL and its pixel size straight from the file header, so exports need no
// canvas and can be built (and tested) anywhere.
export function parseJpegDataUrl(dataUrl: string): JpegImage {
  const match = /^data:image\/jpe?g;base64,(.+)$/i.exec(dataUrl);
  if (!match) throw new Error('Page images must be JPEG for export.');
  const binary = atob(match[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return { bytes, ...readJpegSize(bytes) };
}

export function readJpegSize(bytes: Uint8Array) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('Not a JPEG image.');
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    // Standalone markers have no length field.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2;
      continue;
    }
    const isFrameHeader = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrameHeader) {
      return {
        height: (bytes[i + 5] << 8) | bytes[i + 6],
        width: (bytes[i + 7] << 8) | bytes[i + 8],
        components: bytes[i + 9],
      };
    }
    i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
  }
  throw new Error('Could not read the JPEG size.');
}

// Largest size with the same aspect ratio that fits inside the box.
export function fitInside(width: number, height: number, maxWidth: number, maxHeight: number) {
  const scale = Math.min(maxWidth / width, maxHeight / height);
  return { width: width * scale, height: height * scale };
}
