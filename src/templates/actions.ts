'use client';
// Maps a back-office save/delete to the right service call. Gated work becomes an approval ("Send to owner").
import type { DB, Rec, Role } from '../data/schema.ts';
import { addCustomer, archiveProduct, deleteRecord, requestApproval, saveEmployee, savePromo, saveProduct, saveRecord, saveReservation, saveSupplier } from '../data/actions.ts';
import { uid as uidSafe } from '../data/store.ts';
import { newItem } from '../domain/menu.ts';
import type { Row } from './views.ts';

const GATE_TYPE: Record<string, Parameters<typeof requestApproval>[0]['type']> = { expense: 'expense', asset: 'asset', budget: 'budget', transfer: 'transfer', leave: 'leave', reward: 'points', broadcast: 'broadcast' };
const MANAGER_LIMIT = 500_000;

/** Returns a message for the toast. */
export function saveRow(key: string, f: Record<string, string>, editing: Row | null, ctx: { db: DB; by: string; role: Role; outletId: string; gated: boolean }): string {
  const { db, by, role, outletId } = ctx;
  const num = (v: string | undefined) => Math.round(Number(String(v ?? '').replace(/[^\d.-]/g, '')) || 0);
  switch (key) {
    case 'product': {
      const base = editing ? db.products.find(p => p.id === editing.id)! : null;
      let scope = base?.scope ?? 'global', status = base?.status ?? 'live';
      if (!base) { try { ({ scope, status } = newItem(role === 'owner' ? 'owner' : 'manager', db.tenant.locks)); } catch (e) { return (e as Error).message; } }
      const refused = saveProduct({ id: base?.id ?? uidSafe('p'), name: f.name, categoryId: f.categoryId || 'coffee', basePrice: num(f.basePrice), cost: num(f.cost), sku: f.sku || 'KB-' + Date.now().toString().slice(-4), desc: f.desc ?? '', scope, status, ownerOutletId: scope === 'local' ? (base?.ownerOutletId ?? outletId) : null, hue: base?.hue ?? 30, modifierGroupIds: base?.modifierGroupIds ?? [], promoteRequested: f.promote === 'yes' }, by);
      if (refused) return refused;
      if (base && role !== 'owner' && num(f.basePrice) !== base.basePrice) return 'Saved · price change sent to the owner';
      return status === 'pending_owner' ? 'Saved as outlet-only item · waiting for owner OK' : 'Saved · live on POS, QR menu, kiosk and customer display';
    }
    case 'supplier': return saveSupplier({ id: editing?.id ?? uidSafe('sup'), name: f.name, category: f.category ?? '', phone: f.phone ?? '', terms: f.terms || 'COD' }, by) ? 'Sent to owner for approval' : 'Supplier saved';
    case 'customer': addCustomer(f.name, f.phone, by); return 'Customer added · 50 welcome beans';
    case 'employee': {
      const e = editing ? db.employees.find(x => x.id === editing.id)! : null;
      const r = saveEmployee({ id: e?.id ?? uidSafe('e'), name: f.name, phone: f.phone, role: (f.role || e?.role || 'cashier') as Role, outlets: e?.outlets ?? [outletId], pin: e?.pin ?? String(1000 + Math.floor(Math.random() * 9000)), approvalPin: e?.approvalPin ?? '246810', color: e?.color ?? '#7C3AED', active: true, wage: e?.wage ?? 5_200_000 }, by);
      return r ? 'Making someone a manager needs the owner · request sent' : editing ? 'Saved' : 'Invite sent on WhatsApp with a one-time PIN';
    }
    case 'reservation': saveReservation({ id: editing?.id ?? uidSafe('rs'), outletId, name: f.name, phone: f.phone ?? '', guests: num(f.guests) || 2, table: f.table ?? '', deposit: num(f.deposit), at: Date.now() + 3 * 3600e3, status: 'booked' }, by); return 'Reservation saved';
    case 'promo': return savePromo({ id: editing?.id ?? uidSafe('pr'), name: f.name, code: f.code?.toUpperCase(), kind: (f.kind || 'pct') as 'pct', value: num(f.value), minSpend: num(f.minSpend) }, by) ? 'Promo changes prices: sent to owner' : 'Promo live on POS, QR menu and kiosk';
    default: {
      const row: Rec = { id: editing?.id ?? uidSafe(key), a: f.a ?? '', b: f.b || 'All outlets', c: f.c || 'Draft', d: f.d || new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }), e: f.e ?? '', at: Date.now() };
      const amount = num(f.e);
      if (role === 'manager' && GATE_TYPE[key] && (ctx.gated || amount > MANAGER_LIMIT)) {
        requestApproval({ type: GATE_TYPE[key], title: `${row.a}${amount ? ' · IDR ' + amount.toLocaleString('en-US') : ''}`, amount, requestedBy: by, outletId, payload: { object: key, rec: row } });
        saveRecord(key, { ...row, c: 'Waiting' }, by);
        return 'Saved as waiting · sent to owner';
      }
      saveRecord(key, row, by); return 'Saved · logged in the audit log';
    }
  }
}
export function removeRow(key: string, row: Row, by: string): string {
  if (key === 'product') return archiveProduct(row.id, by) ?? 'Archived · removed from every channel';
  deleteRecord(key, row.id, by); return 'Removed · kept in the audit log';
}
