'use client';
// Customer screens Menu Studio already edits. One editor per screen, so the live page never has two sources:
// the tool here shows what is published and opens the Menu Studio page that changes it.
import Link from '../../ui/Link.tsx';
import { EXTRAS } from '../studio/extras.tsx';
import { DeviceView } from '../studio/Frame.tsx';
import { menuDesign } from '../../data/actions/studio.ts';
import { studioValue, type StudioKey } from '../../system/studio.ts';
import { Icon } from '../../ui/kit.tsx';
import { PAGES } from '../../system/registry.ts';
import type { PP, Tool } from './core.tsx';

export const menuStudioPath = (key: string) => PAGES.find(p => p.surface === 'menu' && p.slug === key)!.path;

export function same(key: StudioKey): Pick<Tool, 'Preview' | 'Panel'> {
  const e = EXTRAS.find(x => x.key === key)!;
  return {
    Preview: ({ x }: PP) => {
      const body = e.preview(studioValue(x.db, key) as never, { d: menuDesign(x.db), db: x.db, outletId: x.outletId, lang: 'en' });
      return e.device === 'print' ? <div style={{ overflow: 'auto', maxWidth: '100%' }}>{body}</div>
        : <DeviceView device={e.device === 'desktop' ? 'desktop' : 'phone'} height={e.device === 'desktop' ? 675 : undefined}>{body}</DeviceView>;
    },
    Panel: () => <div className="stack">
      <p className="muted" style={{ fontSize: 14 }}>This screen is edited in Menu Studio, the same place as the QR menu and kiosk, so every guest sees one version. The preview shows what is published now.</p>
      <Link className="btn btn-primary" href={menuStudioPath(key)}><Icon name="pencil" size={16} />Open in Menu Studio</Link>
    </div>,
  };
}
