'use client';
import NextLink from 'next/link';
import type { ComponentProps } from 'react';
import { leaveFor } from '../system/hosts.ts';

/** next/link that knows hosts: a page another host serves (terms on bornis.id, sign-in on app.) is a full page load,
 *  never a cross-origin prefetch that the proxy's redirect turns into a CORS error. */
export default function Link(p: ComponentProps<typeof NextLink>) {
  const away = typeof p.href === 'string' && typeof location !== 'undefined' ? leaveFor(p.href) : null;
  if (!away) return <NextLink {...p} />;
  return <NextLink {...p} prefetch={false} onClick={e => {
    p.onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault(); location.assign(away);
  }} />;
}
