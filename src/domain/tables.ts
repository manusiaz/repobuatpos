// lg-tables: one floor plan per outlet. The POS table picker, waiter app, QR codes, reservations, PIC sections and the
// manager board all read tablesOf(outlet). A table's name is its key (orders, reservations and tickets store the name).
export type TableShape = 'square' | 'round' | 'long';
export interface FloorTable { name: string; area: string; seats: number; shape: TableShape; x: number; y: number; /** earlier names: QR codes printed before a rename keep opening this table */ was?: string[] }

/** The one rule for "this table is taken": the bill is open, or food is still in the kitchen (paid first: QR, kiosk).
 *  POS table picker, Move table, waiter app, manager board and the floor plan editor all use it. */
const OPEN_BILL = ['open', 'held', 'sent', 'preparing', 'ready', 'served', 'paying'], DEAD = ['voided', 'refunded', 'part_refunded'];
export const holdsTable = (o: { table: string | null; status: string; lines: { fired: boolean; kds: string }[] }) =>
  !!o.table && (OPEN_BILL.includes(o.status) || !DEAD.includes(o.status) && o.lines.some(l => l.fired && l.kds !== 'done'));

export const COLS = 8, ROWS = 12; // grid cells per area
export const autoName = (i: number) => 'T-' + String(i).padStart(2, '0');

/** The outlet's tables: its floor plan, or T-01…T-n from the table count until the plan is drawn. */
export function tablesOf(o: { tables: number; floor?: FloorTable[] } | undefined): FloorTable[] {
  if (!o) return [];
  if (o.floor?.length) return o.floor;
  return Array.from({ length: Math.max(0, o.tables) }, (_, i) => ({ name: autoName(i + 1), area: 'Main', seats: 4, shape: 'square' as const, x: i % 6, y: Math.floor(i / 6) }));
}
export const tableNames = (o: Parameters<typeof tablesOf>[0]) => tablesOf(o).map(t => t.name);
export const areasOf = (ts: FloorTable[]) => [...new Set(ts.map(t => t.area))];

/** First free cell in an area (left to right, top to bottom), for a newly added table. */
export function freeCell(ts: FloorTable[], area: string): { x: number; y: number } {
  const used = new Set(ts.filter(t => t.area === area).map(t => `${t.x},${t.y}`));
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (!used.has(`${x},${y}`)) return { x, y };
  return { x: 0, y: ROWS - 1 };
}
export const nextName = (ts: FloorTable[]) => { const names = new Set(ts.map(t => t.name.toLowerCase())); let i = ts.length + 1; while (names.has(autoName(i).toLowerCase())) i++; return autoName(i); };

/** null when the plan can be saved; otherwise what to fix. */
export function checkFloor(ts: FloorTable[]): string | null {
  const names = new Set<string>(), cells = new Set<string>();
  for (const t of ts) {
    const n = t.name.trim();
    if (!n || n.length > 20) return 'Every table needs a name of 1 to 20 characters.';
    if (names.has(n.toLowerCase())) return `Two tables are called ${n}.`;
    names.add(n.toLowerCase());
    if (!t.area.trim() || t.area.length > 20) return `${n}: the area needs a name of 1 to 20 characters.`;
    if (!Number.isInteger(t.seats) || t.seats < 1 || t.seats > 30) return `${n}: seats must be 1 to 30.`;
    if (!Number.isInteger(t.x) || !Number.isInteger(t.y) || t.x < 0 || t.x >= COLS || t.y < 0 || t.y >= ROWS) return `${n} is outside the floor.`;
    const cell = `${t.area}|${t.x},${t.y}`;
    if (cells.has(cell)) return `${n} sits on another table in ${t.area}.`;
    cells.add(cell);
  }
  return null;
}

/** A table from a QR link or URL: "07" and "T-7" are T-07; any other value is a table name. */
export const tableParam = (q: string) => { let v = q; try { v = decodeURIComponent(q); } catch { /* already decoded ("100%") */ } v = v.trim(); return /^(t-?)?\d{1,3}$/i.test(v) ? autoName(Number(v.replace(/\D/g, ''))) : v; };
/** The table a QR link opens on this outlet's plan (renamed tables answer to their old names), or null when it is not on the plan. */
export function findTable(o: Parameters<typeof tablesOf>[0], q: string): string | null {
  const v = tableParam(q), low = v.toLowerCase(), ts = tablesOf(o);
  return (ts.find(t => t.name.toLowerCase() === low) ?? ts.find(t => t.was?.some(w => w.toLowerCase() === low)))?.name ?? null;
}
/** How a guest reads a table: "T-07" → "07", every other name as written. */
export const tableNo = (t: string) => t.replace(/^T-(?=\d+$)/, '');
