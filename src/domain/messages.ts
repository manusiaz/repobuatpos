// Message templates and their variables: the same text on the Messaging studio previews, on every device's outbox
// and in the server's automation worker (src/integrations/server/worker.ts). Pure: no UI here.
import type { DB, Order, Rec } from '../data/schema.ts';
import { idr } from './money.ts';
import { earn, tierOf } from './loyalty.ts';

// ── Templates ────────────────────────────────────────────────────────────────────────────
export type Cat = 'UTILITY' | 'MARKETING';
export interface Tpl { id: string; name: string; body: string; button: string; cat: Cat; status: 'approved' | 'pending' | 'rejected' | 'draft'; at: number }
export const BASE: Omit<Tpl, 'status' | 'at'>[] = [
  { id: 'thanks_visit', name: 'Thank you for visiting', cat: 'UTILITY', button: 'Rate your visit', body: 'Hi {{name}}, terima kasih sudah mampir ke {{outlet}} hari ini!\n\nKami harap {{item}} kamu enak. Boleh kasih rating 10 detik?' },
  { id: 'e_receipt', name: 'E-receipt', cat: 'UTILITY', button: 'View receipt', body: 'Hi {{name}}, ini struk digital kamu dari {{outlet}}.\n\nTotal: {{total}}\nPoin didapat: +{{points}}' },
  { id: 'order_ready', name: 'Order ready / pickup', cat: 'UTILITY', button: 'Show my order', body: 'Hi {{name}}, pesanan {{order}} sudah siap diambil di counter {{outlet}}. Tidak perlu antre.' },
  { id: 'booking_reminder', name: 'Reservation reminder', cat: 'UTILITY', button: 'Manage booking', body: 'Hi {{name}}, reminder reservasi kamu jam {{time}} untuk {{pax}} orang di {{outlet}}.' },
  { id: 'feedback_request', name: 'Feedback & review link', cat: 'MARKETING', button: 'Write a review', body: 'Senang dengarnya, {{name}}! Mau bantu kami di Google? Tap untuk tulis review.' },
  { id: 'winback_30d', name: 'We miss you', cat: 'MARKETING', button: 'Claim offer', body: 'Lama nggak ketemu, {{name}}. Minggu ini ada promo buat kamu, tinggal tunjukkan kode {{code}}.' },
  { id: 'birthday', name: 'Happy birthday', cat: 'MARKETING', button: 'See my gift', body: 'Selamat ulang tahun lebih awal, {{name}}! Dessert gratis menunggumu sepanjang minggu ulang tahun.' },
  { id: 'staff_alert', name: 'Staff alert', cat: 'UTILITY', button: 'Open BorNiz', body: '{{alert}} · {{outlet}}\n{{text}}' },
  { id: 'points_expiry', name: 'Points expiring', cat: 'UTILITY', button: 'Redeem now', body: 'Hi {{name}}, {{points}} beans kamu akan hangus dalam 14 hari. Tukar dengan hadiah di {{outlet}}?' },
];
export const VARS = ['name', 'outlet', 'item', 'total', 'points', 'order', 'time', 'pax', 'code', 'alert', 'text'];
export function templates(db: DB): Tpl[] {
  const recs = db.records.msg_template ?? [];
  const base = BASE.map(b => { const r = recs.find(x => x.id === b.id); return r ? fromRec(r) : { ...b, status: 'approved' as const, at: 0 }; });
  return [...base, ...recs.filter(r => !BASE.some(b => b.id === r.id)).map(fromRec)];
}
export const fromRec = (r: Rec): Tpl => ({ id: r.id, name: r.a, body: r.b, button: r.c, cat: r.d as Cat, status: r.e as Tpl['status'], at: r.at });

// ── Variables, filled from real data ──
export const first = (n?: string | null) => (n ?? 'Guest').split(' ')[0];
export const outletName = (db: DB, id: string) => db.outlets.find(o => o.id === id)?.name ?? id;
export const latest = (db: DB, outletId: string | null, pred: (o: Order) => boolean = () => true) =>
  db.orders.filter(o => (!outletId || o.outletId === outletId) && pred(o)).reduce<Order | undefined>((a, o) => (!a || o.createdAt > a.createdAt ? o : a), undefined);
export const customerOf = (db: DB, o?: Order) => (o?.customerId ? db.customers.find(c => c.id === o.customerId) : undefined);
/** Variables for message templates, filled from a real paid order of a known customer at this outlet. */
export function orderVars(db: DB, outletId: string, customerId?: string) {
  const o = latest(db, outletId, x => x.status === 'paid' && !!x.customerId && (!customerId || x.customerId === customerId)) ?? latest(db, null, x => x.status === 'paid' && !!x.customerId);
  const c = customerOf(db, o) ?? db.customers[0];
  const pts = o && c ? earn(o.subtotal - o.discount, tierOf(db.ledger, c.id)) : 0;
  const res = db.reservations.find(r => r.status === 'booked');
  const voucher = db.promos.find(p => p.code)?.code ?? '';
  return { name: first(c?.name), outlet: outletName(db, o?.outletId ?? outletId), item: o?.lines[0]?.name ?? '', total: o ? idr(o.total) : '', points: String(pts), order: o?.no ?? '', time: res ? new Date(res.at).toTimeString().slice(0, 5) : '', pax: String(res?.guests ?? ''), code: voucher, _order: o, _customer: c };
}
export const fillVars = (t: string, vars: Record<string, unknown>) => t.replace(/\{\{?(\w+)\}?\}/g, (m, k) => (typeof vars[k] === 'string' && vars[k] ? vars[k] as string : m));
