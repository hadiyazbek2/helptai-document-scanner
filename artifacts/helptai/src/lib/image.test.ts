import { describe, expect, it } from 'vitest';
import { fitLongEdge } from './image';

describe('fitLongEdge', () => {
  it('scales the longer side down to the limit, keeping the shape', () => {
    expect(fitLongEdge(4000, 3000, 1400)).toEqual({ width: 1400, height: 1050 });
    expect(fitLongEdge(3000, 4000, 1400)).toEqual({ width: 1050, height: 1400 });
  });
  it('never enlarges a small photo', () => {
    expect(fitLongEdge(800, 600, 1400)).toEqual({ width: 800, height: 600 });
  });
  it('never returns a zero size', () => {
    expect(fitLongEdge(10000, 1, 1400).height).toBe(1);
  });
});
