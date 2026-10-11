// Delivery platforms → one internal order shape (the same one simulatePlatformOrder / acceptOnline work on).
// Relay format: a normalized JSON order signed with the outlet's webhook secret (X-BorNiz-Signature, see sign.ts).
// Native GoFood / GrabFood / ShopeeFood payloads need partner API access: their parsers go in NATIVE.
import type { Order } from '../../../data/schema.ts';
import type { Source } from '../../../domain/order.ts';
import { verifyOutgoing } from '../sign.ts';
import { NotConnected, type Headers } from '../types.ts';

export const PLATFORMS = ['gofood', 'grabfood', 'shopeefood'] as const;
export type Platform = typeof PLATFORMS[number];
export interface PlatformOrder {
  externalId: string; merchantId: string; status?: 'new' | 'cancelled'; tier?: 'rush' | 'standard' | 'saver';
  items: { id?: string; sku?: string; name: string; qty: number; price: number; modifiers?: { name: string; price: number }[]; note?: string }[];
  customer?: { name?: string; phone?: string }; discount?: number; total?: number; placedAt?: number; note?: string;
}

const NATIVE: Partial<Record<Platform, (h: Headers, raw: string, secrets: Record<string, string>) => PlatformOrder | null>> = {};

/** null = signature does not verify. Throws NotConnected for a native payload whose driver is not written yet. */
export function parsePlatform(platform: Platform, h: Headers, raw: string, secrets: Record<string, string>): PlatformOrder | null {
  const sig = h.get('x-borniz-signature');
  if (!sig) { const native = NATIVE[platform]; if (!native) throw new NotConnected(platform); return native(h, raw, secrets); }
  if (!secrets.webhookSecret || !verifyOutgoing(secrets.webhookSecret, raw, sig)) return null;
  const o = JSON.parse(raw) as PlatformOrder;
  if (!o.externalId || !o.merchantId || !Array.isArray(o.items) || !o.items.length) throw new Error('Order needs externalId, merchantId and items');
  return o;
}

const PREP = { rush: 10, standard: 18, saver: 30 } as const;
/** Internal order document. productId = our product id or SKU as the platform menu was synced with; the server maps SKUs and stations. */
export function normalizeOrder(platform: Platform, o: PlatformOrder, outletId: string, now = Date.now()): Order {
  const at = o.placedAt ?? now, tier = o.tier ?? 'standard';
  const lines = o.items.map((it, i) => ({
    id: `l${i + 1}`, productId: it.id ?? it.sku ?? '', name: it.name, qty: Math.max(1, Math.round(it.qty)), unitPrice: Math.round(it.price), flashPrice: null,
    mods: (it.modifiers ?? []).map(m => ({ name: m.name, price: Math.round(m.price) })), note: it.note ?? '', discountPct: 0, station: 'kitchen' as const, kds: 'new' as const, fired: false,
  }));
  const subtotal = lines.reduce((a, l) => a + (l.unitPrice + l.mods.reduce((s, m) => s + m.price, 0)) * l.qty, 0);
  const discount = Math.min(subtotal, Math.round(o.discount ?? 0));
  const id = `${platform}-${o.externalId}`.replace(/[^A-Za-z0-9_-]/g, '');
  return {
    id, no: '', outletId, sessionId: null, source: platform as Source, type: 'delivery', status: o.status === 'cancelled' ? 'voided' : 'open', table: null, customerId: null,
    lines, discountPct: 0, promoIds: [], guests: 1, subtotal, discount, service: 0, tax: 0, total: o.total != null ? Math.round(o.total) : subtotal - discount,
    createdAt: at, paidAt: null, cashierId: null, tier, readyBy: at + (PREP[tier] + 4) * 60e3, idemKey: id,
    note: [o.customer?.name, o.customer?.phone, o.note, o.status === 'cancelled' ? 'Cancelled by platform' : ''].filter(Boolean).join(' · ') || undefined,
  };
}
