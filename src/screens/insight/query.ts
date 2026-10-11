'use client';
// View filters live in the URL (?outlet=sen&period=7d) so every view can be linked and reloaded.
import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export function useQuery<K extends string>(defaults: Record<K, string>) {
  const sp = useSearchParams(), router = useRouter(), path = usePathname();
  const q = Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, sp.get(k) ?? v])) as Record<K, string>;
  const set = useCallback((patch: Partial<Record<K, string | null>>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch) as [string, string | null][]) {
      if (v == null || v === (defaults as Record<string, string>)[k]) next.delete(k); else next.set(k, v);
    }
    const s = next.toString();
    router.replace(path + (s ? '?' + s : ''), { scroll: false });
  }, [sp, router, path, defaults]);
  return [q, set] as const;
}
