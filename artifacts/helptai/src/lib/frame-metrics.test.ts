import { describe, expect, it } from 'vitest';
import {
  alignedDifference, clarityFromSharpness, frameSharpness, normalize, tileSharpness, type Gray,
} from './frame-metrics';
import { blur, shift, textPage } from './test-images';

describe('frameSharpness', () => {
  const sharp = textPage(1);

  it('scores a sharp page far above a blurred copy of it', () => {
    expect(frameSharpness(sharp)).toBeGreaterThan(frameSharpness(blur(sharp, 2)) * 5);
    expect(frameSharpness(blur(sharp, 1))).toBeGreaterThan(frameSharpness(blur(sharp, 3)));
  });

  it('does not change much when the lighting is dimmer', () => {
    const dim: Gray = { ...sharp, data: sharp.data.map((v) => v * 0.45) };
    const ratio = frameSharpness(dim) / frameSharpness(sharp);
    expect(ratio).toBeGreaterThan(0.6);
    expect(ratio).toBeLessThan(1.4);
  });

  it('is not fooled by a plain region covering part of the frame', () => {
    const covered: Gray = { ...sharp, data: new Float32Array(sharp.data) };
    for (let y = 200; y < sharp.height; y += 1) for (let x = 0; x < sharp.width; x += 1) covered.data[y * sharp.width + x] = 150;
    expect(frameSharpness(covered)).toBeGreaterThan(frameSharpness(sharp) * 0.6);
  });

  it('is not fooled by one sharp corner on an otherwise blurry frame', () => {
    const mostlyBlurry = blur(sharp, 3);
    for (let y = 0; y < 60; y += 1) for (let x = 0; x < 60; x += 1) mostlyBlurry.data[y * sharp.width + x] = sharp.data[y * sharp.width + x];
    expect(frameSharpness(mostlyBlurry)).toBeLessThan(frameSharpness(sharp) * 0.5);
  });

  it('returns 48 tiles', () => {
    expect(tileSharpness(sharp)).toHaveLength(48);
  });
});

describe('clarityFromSharpness', () => {
  it('rises with sharpness and stays within 0..1', () => {
    const values = [0, 0.05, 0.3, 1, 3, 10].map(clarityFromSharpness);
    expect(values[0]).toBe(0);
    expect(values[5]).toBe(1);
    for (let i = 1; i < values.length; i += 1) expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    expect(clarityFromSharpness(0.2)).toBeLessThan(0.5); // blurry frames no longer read as 100%
    expect(clarityFromSharpness(2)).toBeGreaterThan(0.8);
  });
});

describe('alignedDifference', () => {
  const a = normalize(textPage(1));
  it('treats a slightly shifted copy as the same view', () => {
    expect(alignedDifference(a, normalize(shift(textPage(1), 3, -2)))).toBeLessThan(0.15);
  });
  it('sees a different page as clearly more different than a shifted copy', () => {
    const different = alignedDifference(a, normalize(textPage(2)));
    expect(different).toBeGreaterThan(0.2);
    expect(different).toBeGreaterThan(alignedDifference(a, normalize(shift(textPage(1), 3, -2))) * 2);
  });
});
