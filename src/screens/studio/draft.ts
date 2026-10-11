'use client';
// Draft lifecycle shared by Menu Studio and Brand Studio: autosave, compare with published, status chip.
import { useEffect, useRef } from 'react';
import type { DB } from '../../data/schema.ts';
import { snapshot } from '../../data/store.ts';
import { approvalFor, discardDraft, draftOf, saveDraft, type Kind } from '../../data/actions/studio.ts';
import type { StudioStatus } from './Frame.tsx';

/** Key-order independent JSON, so a draft equal to the published version reads as "Published". */
export const stable = (v: unknown) => JSON.stringify(v, (_k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x);

/** Debounced autosave of a draft; an unchanged draft is dropped. */
export function useAutosave(kind: Kind, value: unknown, dirty: boolean, by: string) {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => { if (dirty) saveDraft(kind, value, by); else if (draftOf(snapshot(), kind, by)) discardDraft(kind, by); }, 700);
    return () => clearTimeout(t);
  }, [value]);
}

/** Design Notes states: Draft · Published · Contrast fail (+ waiting / rejected / offline). */
export function draftState(db: DB, kind: Kind, by: string, dirty: boolean, contrastBad: boolean) {
  const last = db.versions.find(v => v.kind === kind && v.by === by && v.status !== 'draft'), ap = last && approvalFor(db, last.id);
  const waiting = last?.status === 'pending_owner' && ap?.status === 'waiting', rejected = last?.status === 'pending_owner' && ap?.status === 'rejected';
  const online = db.device.online;
  const status: StudioStatus = !online ? { tone: 'danger', text: 'Offline · draft kept on this device' } : waiting ? { tone: 'warning', text: 'Waiting for owner' }
    : contrastBad ? { tone: 'danger', text: 'Contrast fail' } : rejected ? { tone: 'danger', text: 'Owner rejected · edit and send again' }
    : dirty ? { tone: 'neutral', text: 'Draft · saved' } : { tone: 'success', text: 'Published' };
  const blocked = !online ? 'You are offline' : !dirty ? 'Nothing to publish' : contrastBad ? 'Fix contrast to publish' : waiting ? 'Already waiting for the owner' : '';
  return { status, blocked, waiting };
}
