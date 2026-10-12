'use client';
// What the merchant published in Studios, worn by every guest screen (QR menu and customer links): legal pages and the
// company line, "Powered by BorNiz" unless white-labelled, the tax-inclusive price note, and the embeds (WhatsApp chat
// button, review score, custom head code on menu pages only, never on checkout or payment).
import { useEffect, useState } from 'react';
import type { DB } from '../../data/schema.ts';
import { menuDesign } from '../../data/actions/studio.ts';
import { embeds, legal, priceRules, whiteLabel } from '../../system/tools.ts';
import { Icon, Sheet } from '../../ui/kit.tsx';
import { MUTED } from './kit.tsx';

const LEGAL = { terms: 'Terms of service', privacy: 'Privacy policy', refund: 'Refund policy' } as const;
type Page = keyof typeof LEGAL;
const NO_SCRIPTS = ['checkout-and-payment', 'qris-payment'];

export function GuestFooter({ db, outletId, slug }: { db: DB; outletId: string; slug: string }) {
  const lg = legal(db), wl = whiteLabel(db), em = embeds(db), pr = priceRules(db, outletId);
  const powered = !wl && menuDesign(db).opts.powered !== false;
  const [open, setOpen] = useState<Page | null>(null);
  const out = db.outlets.find(o => o.id === outletId), phone = (out?.phone || db.tenant.profile?.phone || '').replace(/\D/g, '').replace(/^0/, '62');
  const rv = db.reviews.filter(r => r.outletId === outletId), stars = rv.length ? rv.reduce((a, r) => a + r.stars, 0) / rv.length : 0;
  useEffect(() => { // custom head code runs on menu pages only
    const code = String(em?.code ?? '').trim();
    if (!code || NO_SCRIPTS.includes(slug)) return;
    const frag = document.createRange().createContextualFragment(code), nodes = [...frag.childNodes];
    document.head.append(frag);
    return () => nodes.forEach(n => n.parentNode?.removeChild(n));
  }, [em?.code, slug]);
  useEffect(() => { if (wl) document.title = wl.sub ? `${wl.name} · ${wl.sub}` : wl.name; }, [wl?.name, wl?.sub]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!lg && !powered && !pr.inclTax && !em) return null;
  return <footer className="stack sm" style={{ padding: '20px 16px 104px', alignItems: 'center', textAlign: 'center', fontSize: 13, color: MUTED }}>
    {pr.inclTax && <span>Prices include tax and service</span>}
    {em?.reviews && rv.length > 0 && <span className="row" style={{ gap: 4 }}><Icon name="star" size={14} />{stars.toFixed(1)} · {rv.length} review{rv.length === 1 ? '' : 's'}</span>}
    {lg && <span className="row wrap" style={{ justifyContent: 'center', gap: 4 }}>{(Object.keys(LEGAL) as Page[]).map(k =>
      <button key={k} onClick={() => setOpen(k)} style={{ minHeight: 44, padding: '0 8px', border: 0, background: 'none', color: 'inherit', textDecoration: 'underline', cursor: 'pointer', fontSize: 13 }}>{LEGAL[k]}</button>)}</span>}
    {lg && <span>{lg.co}</span>}
    {powered && <span style={{ fontSize: 12 }}>Powered by BorNiz</span>}
    {em?.wa && phone && <a href={`https://wa.me/${phone}`} target="_blank" rel="noopener" aria-label="Chat with us on WhatsApp"
      style={{ position: 'fixed', right: 16, bottom: 96, zIndex: 7, width: 56, height: 56, borderRadius: 99, background: 'var(--success)', color: 'var(--ink-0)', display: 'grid', placeItems: 'center', boxShadow: 'var(--shadow-e2)' }}><Icon name="message-circle" /></a>}
    {lg && <Sheet open={!!open} onClose={() => setOpen(null)} side="bottom" title={open ? LEGAL[open] : ''} sub={lg.co}>
      <div className="stack"><p style={{ whiteSpace: 'pre-wrap', fontSize: 15 }}>{open ? lg[open] : ''}</p>
        <span style={{ fontSize: 13, color: MUTED }}>Payments processed by BorNiz Payments (PJP licensed by Bank Indonesia).</span></div>
    </Sheet>}
  </footer>;
}
