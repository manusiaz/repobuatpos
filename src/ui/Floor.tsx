'use client';
// The floor plan grid: one drawing for the editor (Tables & floor plan) and the POS table picker. Cells are 1×1;
// a table sits in one cell, its shape and seats are shown on it.
import type { CSSProperties, ReactNode } from 'react';
import { COLS, type FloorTable } from '../domain/tables.ts';

export interface CellProps { x: number; y: number }
export function FloorGrid({ tables, rows, cell, table, onDropAt, size = 76 }: {
  tables: FloorTable[]; rows: number; size?: number;
  table: (t: FloorTable) => ReactNode;
  cell?: (c: CellProps) => ReactNode;
  onDropAt?: (name: string, c: CellProps) => void;
}) {
  const at = new Map(tables.map(t => [`${t.x},${t.y}`, t]));
  const cols = cell ? COLS : Math.max(1, ...tables.map(t => t.x + 1)); // a read-only plan (POS) only spans the columns in use
  return <div className="scroll-x" style={{ paddingBottom: 4 }}>
    <div role="grid" aria-label="Floor plan" style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, ${size}px)`, gridAutoRows: `${size}px`, gap: 8, padding: 12, borderRadius: 'var(--radius-lg)', background: 'var(--bg-sunken)', width: 'max-content' }}>
      {Array.from({ length: rows * cols }, (_, i) => {
        const x = i % cols, y = Math.floor(i / cols), t = at.get(`${x},${y}`);
        return <div key={i} role="gridcell" style={{ display: 'grid' }}
          onDragOver={onDropAt ? e => e.preventDefault() : undefined}
          onDrop={onDropAt ? e => { e.preventDefault(); const n = e.dataTransfer.getData('text/table'); if (n) onDropAt(n, { x, y }); } : undefined}>
          {t ? table(t) : cell?.({ x, y }) ?? null}</div>;
      })}
    </div>
  </div>;
}

/** How a table looks: round tables are circles, long tables are wide pills, square tables are rounded squares. */
export const tableShape = (t: FloorTable): CSSProperties => ({
  borderRadius: t.shape === 'round' ? '50%' : t.shape === 'long' ? 'var(--radius-xl)' : 'var(--radius-md)',
  ...(t.shape === 'long' ? { marginInline: -4 } : {}),
});
