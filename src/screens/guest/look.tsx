'use client';
// What the Customization Studio publishes for guest screens beyond the theme: icon style and motion (CSS on [data-guest]),
// the app icon / favicon / share title in the browser, page titles for search, and ad pixels behind the guest's consent.
import { useEffect } from 'react';
import type { DB, Theme } from '../../data/schema.ts';
import { guestCss, pixelPlan, toolPublished, toolValue } from '../../system/tools.ts';
import { useLocal } from './kit.tsx';

/** Icon style + animation level for every [data-guest] root on the page. */
export const GuestStyle = ({ db }: { db: DB }) => <style>{guestCss(db)}</style>;

function upsert(tag: 'link' | 'meta', key: string, val: string, attr: 'href' | 'content') {
  const sel = tag === 'link' ? `link[rel="${key}"]` : `meta[name="${key}"],meta[property="${key}"]`;
  let el = document.head.querySelector<HTMLLinkElement | HTMLMetaElement>(sel), made = false;
  if (!el) { el = document.createElement(tag); if (tag === 'link') (el as HTMLLinkElement).rel = key; else el.setAttribute(key.startsWith('og:') ? 'property' : 'name', key); document.head.appendChild(el); made = true; }
  const prev = el.getAttribute(attr);
  el.setAttribute(attr, val);
  return () => { if (made) el.remove(); else if (prev != null) el.setAttribute(attr, prev); };
}

/** The published app icon (logo or initials on the merchant colour), drawn as a PNG. */
function drawIcon(v: ReturnType<typeof toolValue<'appicon'>>, t: Theme, size: number, logo: HTMLImageElement | null) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d'); if (!g) return '';
  const bg = v.bg === 'accent' ? t.acc : v.bg === 'dark' ? t.ink : t.p;
  g.fillStyle = bg; g.beginPath(); g.roundRect(0, 0, size, size, v.shape === 'circle' ? size / 2 : v.shape === 'square' ? size * .06 : size * .22); g.fill();
  if (logo) { const s = size * .62; g.drawImage(logo, (size - s) / 2, (size - s) / 2, s, s); }
  else { g.fillStyle = v.bg === 'dark' ? t.paper : '#ffffff'; g.font = `700 ${size * .42}px 'Space Grotesk', sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(v.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(), size / 2, size / 2 + size * .03); }
  return c.toDataURL('image/png');
}

/** Browser chrome of a guest page: favicon, home-screen icon and name, theme colour, title and description, ad pixels. */
export function GuestHead({ db, slug, theme }: { db: DB; slug: string; theme: Theme }) {
  const live = toolPublished(db, 'appicon')?.id;
  useEffect(() => {
    if (!live) return;
    const v = toolValue(db, 'appicon'), undo: (() => void)[] = [];
    const apply = (logo: HTMLImageElement | null) => {
      undo.splice(0).forEach(f => f());
      undo.push(upsert('link', 'icon', drawIcon(v, theme, 64, logo), 'href'), upsert('link', 'apple-touch-icon', drawIcon(v, theme, 180, logo), 'href'),
        upsert('meta', 'apple-mobile-web-app-title', v.name, 'content'), upsert('meta', 'application-name', v.name, 'content'), upsert('meta', 'og:title', v.og, 'content'),
        upsert('meta', 'theme-color', v.bg === 'accent' ? theme.acc : v.bg === 'dark' ? theme.ink : theme.p, 'content'));
    };
    apply(null);
    if (v.logo) { const i = new Image(); i.onload = () => apply(i); i.src = v.logo; }
    return () => undo.forEach(f => f());
  }, [live, theme.p, theme.acc, theme.ink, theme.paper]); // eslint-disable-line react-hooks/exhaustive-deps

  const [consent, setConsent] = useLocal<boolean | null>('bn-ads-consent:' + db.tenant.id, null);
  const plan = pixelPlan(db, slug, consent);
  useEffect(() => {
    const was = document.title;
    if (plan.title) document.title = plan.title;
    const undo = plan.desc ? upsert('meta', 'description', plan.desc, 'content') : () => {};
    return () => { document.title = was; undo(); };
  }, [plan.title, plan.desc]);
  const tags = plan.tags.map(t => t.id).join(',');
  useEffect(() => {
    for (const t of plan.tags) {
      if (document.getElementById('bn-px-' + t.id)) continue; // a loaded pixel cannot be unloaded; it never loads again
      if (t.init) { const s = document.createElement('script'); s.text = t.init; document.head.appendChild(s); }
      const s = document.createElement('script'); s.id = 'bn-px-' + t.id; s.async = true; s.src = t.src; document.head.appendChild(s);
    }
  }, [tags]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!plan.ask) return null;
  return <div role="dialog" aria-label="Ads measurement" style={{ position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 'calc(92px + env(safe-area-inset-bottom))', width: 'min(492px, calc(100vw - 28px))', zIndex: 30, padding: 14, borderRadius: 18, background: 'var(--ink-0)', color: 'var(--bn-ink)', boxShadow: 'var(--shadow-e2)', display: 'flex', flexDirection: 'column', gap: 10 }}>
    <span style={{ fontSize: 14 }}>{db.tenant.name} would like to measure its ads (Meta, TikTok, Google) on this menu. Payment pages are never tracked.</span>
    <div className="row" style={{ gap: 8 }}><button className="btn grow" style={{ height: 48 }} onClick={() => setConsent(false)}>No thanks</button><button className="btn btn-primary grow" style={{ height: 48 }} onClick={() => setConsent(true)}>Allow</button></div>
  </div>;
}
