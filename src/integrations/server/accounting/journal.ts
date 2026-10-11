// Daily sales journal per outlet, from the same sales math as every dashboard (src/screens/insight/metrics.ts).
// Pure: the browser downloads it (journal-csv connector); Jurnal / Accurate drivers will post the same rows.
import type { DB } from '../../../data/schema.ts';
import type { Method } from '../../../domain/order.ts';
import { DAY, METHOD_LABEL, byMethod, soldOrders, startOfDay, voidsAndRefunds, type Range } from '../../../screens/insight/metrics.ts';
import { JOURNAL_ACCOUNTS } from '../../connectors/accounting.ts';

export interface JournalRow { date: string; outlet: string; account: string; memo: string; debit: number; credit: number }
const DEFAULT = Object.fromEntries(JOURNAL_ACCOUNTS.map(f => [f.key, f.placeholder ?? f.label]));
const ymd = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export function journalRows(db: DB, outlet: string, r: Range, accounts: Record<string, unknown> = {}): JournalRow[] {
  const acc = (k: string) => String(accounts[k] || DEFAULT[k]);
  const out: JournalRow[] = [];
  const outlets = db.outlets.filter(o => outlet === 'all' || o.id === outlet);
  const methodOf = new Map(db.payments.map(p => [p.id, p.method]));
  for (let t = startOfDay(r.from); t < r.to; t += DAY) {
    const day = { from: Math.max(t, r.from), to: Math.min(t + DAY, r.to) };
    for (const o of outlets) {
      const rows: JournalRow[] = [], date = ymd(t);
      const add = (account: string, memo: string, debit: number, credit = 0) => { if (debit || credit) rows.push({ date, outlet: o.name, account, memo, debit, credit }); };
      const sold = soldOrders(db, o.id, day), sum = (f: (x: typeof sold[number]) => number) => sold.reduce((a, x) => a + f(x), 0);
      for (const m of byMethod(db, o.id, day)) add(acc('acc_' + m.method), `${METHOD_LABEL[m.method]} received (${m.count})`, m.amount);
      add(acc('acc_discount'), 'Discounts', sum(x => x.discount));
      add(acc('acc_sales'), `Sales (${sold.length} orders)`, 0, sum(x => x.total - x.service - x.tax + x.discount));
      add(acc('acc_service'), 'Service charge', 0, sum(x => x.service));
      add(acc('acc_tax'), 'PB1 tax', 0, sum(x => x.tax));
      for (const f of voidsAndRefunds(db, o.id, day).refunds) {
        const m = (methodOf.get(f.paymentId) ?? 'cash') as Method;
        add(acc('acc_refund'), `Refund · ${f.reason}`, f.amount);
        add(acc('acc_' + m), `Refund paid out (${METHOD_LABEL[m]})`, 0, f.amount);
      }
      const diff = rows.reduce((a, x) => a + x.debit - x.credit, 0);
      if (diff) add(acc('acc_rounding'), 'Rounding and payment timing', diff < 0 ? -diff : 0, diff > 0 ? diff : 0);
      out.push(...rows);
    }
  }
  return out;
}

const cell = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
export const journalCsv = (rows: JournalRow[]) =>
  ['Date,Outlet,Account,Description,Debit,Credit', ...rows.map(x => [x.date, x.outlet, x.account, x.memo, x.debit, x.credit].map(cell).join(','))].join('\n') + '\n';

/** Browser: saves journal-<from>-<to>.csv. */
export function downloadJournalCsv(db: DB, outlet: string, r: Range, accounts: Record<string, unknown> = {}) {
  const blob = new Blob([journalCsv(journalRows(db, outlet, r, accounts))], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `journal-${ymd(r.from)}-${ymd(r.to - 1)}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
