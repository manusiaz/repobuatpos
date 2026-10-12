'use client';
// Letterhead on printed documents (Studios › Letterhead, invoices & PDF reports): company block on top, signature area
// and footer at the bottom. Shown only on paper / PDF (print), so the screen keeps the normal page.
import type { ReactNode } from 'react';
import type { DB } from '../data/schema.ts';
import { letterhead } from '../system/tools.ts';
import { onColor, themeColor } from '../screens/studios/core.tsx';

export function Letterhead({ db, children }: { db: DB; children: ReactNode }) {
  const v = letterhead(db);
  if (!v) return <>{children}</>;
  const ac = themeColor(db.theme, String(v.accent)), center = v.pos === 'center';
  return <>
    <div className="print-only" style={{ borderBottom: `3px solid ${ac}`, paddingBottom: 12, marginBottom: 12 }}>
      <div style={{ display: 'flex', flexDirection: center ? 'column' : 'row', alignItems: center ? 'center' : 'flex-start', textAlign: center ? 'center' : 'left', gap: 12 }}>
        <span style={{ width: 44, height: 44, borderRadius: 10, background: ac, color: onColor(ac, db.theme.ink), display: 'grid', placeItems: 'center', fontWeight: 800, flex: 'none' }}>{db.tenant.name.split(' ').map(w => w[0]).join('').slice(0, 2)}</span>
        <div className="stack" style={{ gap: 2 }}><b style={{ fontSize: 16 }}>{String(v.co)}</b><span>{String(v.addr ?? '')}</span>{v.npwp && <span>NPWP {String(v.npwp)}</span>}</div>
      </div>
    </div>
    {children}
    <div className="print-only" style={{ marginTop: 24 }}>
      {v.sign && <div className="row between" style={{ marginBottom: 16 }}>{['Prepared by', 'Approved by'].map(k => <div key={k} style={{ width: '44%', borderTop: '1px solid currentColor', paddingTop: 4, minHeight: 48 }}>{k}</div>)}</div>}
      {v.foot && <p style={{ textAlign: 'center', borderTop: '1px solid var(--border)', paddingTop: 8 }}>{String(v.foot)}</p>}
    </div>
  </>;
}
