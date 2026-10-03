import type { CSSProperties } from 'react';
import type { Page } from '@/lib/doc-model';
import { blockLines, blockRect, boxToRect, fitText, lineHeight, pageSpace, type PageBlock, type PageSpace } from '@/lib/layout';

// Page coordinates are measured in "units" where the page is 1000 wide. Font sizes are set in
// container-width units (cqw) so the rebuilt page scales with its container at any size.
const UNITS = 1000;

function BlockContent({ block, fontSize, lines, leading = lineHeight }: { block: PageBlock; fontSize: string; lines: string[]; leading?: number }) {
  const style: CSSProperties = { fontSize, lineHeight: leading };
  if (block.type === 'table') {
    return (
      <table className="replica-table" style={style}>
        <tbody>
          {(block.rows ?? []).map((row, r) => (
            <tr key={r}>{row.map((cell, c) => <td key={c}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (block.type === 'list') {
    return (
      <ul className="replica-list" style={style}>
        {(block.items ?? []).map((item, i) => <li key={i}>{item}</li>)}
      </ul>
    );
  }
  return (
    <p className={`replica-text replica-${block.type}`} style={style}>
      {lines.map((line, i) => <span key={i}>{line}{i < lines.length - 1 ? <br /> : null}</span>)}
    </p>
  );
}

// Fitting a list or table uses its real rows, not the wrapped preview text.
function fitFor(block: PageBlock, width: number, height: number) {
  const spread = block.type === 'lines' || block.type === 'list';
  return fitText(blockLines(block), width, height, block.type === 'heading' ? height / lineHeight : UNITS / 18, spread);
}

function FigureCrop({ page, rect, space }: { page: Page; rect: ReturnType<typeof boxToRect>; space: PageSpace }) {
  // Show just this region of the original photo.
  void space;
  const sizeX = 100 / rect.width;
  const sizeY = 100 / rect.height;
  const posX = rect.width >= 1 ? 0 : (rect.x / (1 - rect.width)) * 100;
  const posY = rect.height >= 1 ? 0 : (rect.y / (1 - rect.height)) * 100;
  return (
    <div
      className="replica-figure"
      role="img"
      aria-label="Figure from the page"
      style={{ backgroundImage: `url(${page.image})`, backgroundSize: `${sizeX}% ${sizeY}%`, backgroundPosition: `${posX}% ${posY}%` }}
    />
  );
}

// The page rebuilt from its blocks at the positions they had on the original. Blocks that have
// no known position are listed underneath, in reading order.
export function PageReplica({ page }: { page: Page }) {
  const space = pageSpace(page);
  const heightUnits = UNITS * space.aspect;
  const placed: Array<{ block: PageBlock; index: number }> = [];
  const unplaced: Array<{ block: PageBlock; index: number }> = [];
  page.blocks.forEach((block, index) => {
    (blockRect(block.box, space) ? placed : unplaced).push({ block, index });
  });

  return (
    <div className="replica" data-testid="page-replica">
      <div className="replica-page" style={{ aspectRatio: `${1} / ${space.aspect}` }}>
        {placed.map(({ block, index }) => {
          const rect = blockRect(block.box, space)!;
          const width = rect.width * UNITS;
          const height = rect.height * heightUnits;
          const style: CSSProperties = {
            left: `${rect.x * 100}%`,
            top: `${rect.y * 100}%`,
            width: `${rect.width * 100}%`,
            height: `${rect.height * 100}%`,
          };
          if (block.type === 'figure') {
            return (
              <div key={index} className="replica-block" style={style}>
                <FigureCrop page={page} rect={boxToRect(block.box!)} space={space} />
              </div>
            );
          }
          const { fontSize, lines, lineHeight: leading } = fitFor(block, width, height);
          return (
            <div key={index} className={`replica-block replica-type-${block.type}`} style={style}>
              <BlockContent block={block} fontSize={`${fontSize / 10}cqw`} lines={lines} leading={leading} />
            </div>
          );
        })}
      </div>
      {unplaced.length > 0 && (
        <div className="replica-flow">
          {unplaced.map(({ block, index }) => (
            <div key={index} className={`replica-type-${block.type}`}>
              <BlockContent block={block} fontSize="0.95rem" lines={blockLines(block)} />
            </div>
          ))}
        </div>
      )}
      {!page.blocks.length && <p className="replica-empty">No readable text was returned for this page.</p>}
    </div>
  );
}
