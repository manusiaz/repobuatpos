'use client';
// Selfie at clock in / out against buddy punching ("titip absen"). The front camera opens in a sheet; the shot is
// downscaled to 320 px wide JPEG and stored on the clock event. The owner's photo rule decides what a blocked camera allows.
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../app/context.tsx';
import { Badge, Icon, Sheet } from './kit.tsx';
import { photoRequired } from '../system/settings.ts';
import { clockShot, missingPhoto, type ClockShot } from '../domain/shift.ts';
import type { ClockEvent } from '../data/schema.ts';

/** optional: the clock event rides on another step (opening or closing a drawer) that must not be blocked by the camera;
 *  without a photo that step goes ahead and the clock event is left out (rule on) or marked "no photo" (rule off). */
export interface SelfieRequest { who: string; kind: 'in' | 'out'; label?: string; optional?: boolean; onShot: (shot: ClockShot) => void }
const MAX_W = 320;

function SelfieSheet({ req, onClose }: { req: SelfieRequest; onClose: () => void }) {
  const { db } = useApp();
  const required = photoRequired(db);
  const video = useRef<HTMLVideoElement>(null), stream = useRef<MediaStream | null>(null);
  const [err, setErr] = useState(''), [ready, setReady] = useState(false);
  useEffect(() => {
    let off = false;
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!md?.getUserMedia) { setErr('This device has no camera'); return; }
    md.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 } }, audio: false }).then(s => {
      if (off) { s.getTracks().forEach(t => t.stop()); return; }
      stream.current = s;
      if (video.current) { video.current.srcObject = s; video.current.play().catch(() => {}); }
    }).catch((e: Error) => setErr(e.name === 'NotAllowedError' ? 'Camera blocked' : e.name === 'NotFoundError' ? 'No camera found' : 'Camera unavailable'));
    return () => { off = true; stream.current?.getTracks().forEach(t => t.stop()); };
  }, []);
  const done = (shot: ClockShot | null) => { if (!shot) return; onClose(); req.onShot(shot); };
  const take = () => {
    const v = video.current; if (!v?.videoWidth) return;
    const w = Math.min(MAX_W, v.videoWidth), h = Math.round((v.videoHeight * w) / v.videoWidth);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d')!.drawImage(v, 0, 0, w, h);
    done(clockShot(required, req.kind, c.toDataURL('image/jpeg', 0.7)));
  };
  const verb = req.label ?? (req.kind === 'in' ? 'Clock in' : 'Clock out');
  return <Sheet open onClose={onClose} side="center" title={`${verb} · ${req.who}`} sub="Take a quick photo so the manager knows it was you."
    footer={<>
      {(!required || req.optional) && <button className="btn btn-pos" onClick={() => done(clockShot(false, req.kind, null, err || 'Skipped'))}>{err || req.optional ? `${verb} without photo` : 'Skip photo'}</button>}
      <button className="btn btn-primary btn-pos" disabled={!!err || !ready} onClick={take}><Icon name="camera" />Take photo · {verb.toLowerCase()}</button>
    </>}>
    <div className="stack" style={{ alignItems: 'center' }}>
      {err ? <div className="banner b-warning" role="alert"><Icon name="camera-off" /><span><b>{err}.</b> {required ? (req.optional ? 'You can go on, but you are not clocked ' + req.kind + ' until you clock with a photo.' : 'A photo is required at clock in and out. Allow the camera, or ask the manager.') : 'You can clock without a photo; it is marked for the manager to review.'}</span></div>
        : <video ref={video} playsInline muted autoPlay onLoadedData={() => setReady(true)} aria-label="Camera preview"
          style={{ width: '100%', maxWidth: 360, aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 16, background: 'var(--bg-sunken)', transform: 'scaleX(-1)' }} />}
    </div>
  </Sheet>;
}

/** const selfie = useSelfie(); selfie.ask({ who, kind, onShot }) ; render {selfie.sheet} */
export function useSelfie() {
  const [req, setReq] = useState<SelfieRequest | null>(null);
  return { ask: setReq, sheet: req ? <SelfieSheet key={req.who + req.kind} req={req} onClose={() => setReq(null)} /> : null };
}

/** Thumbnail of a clock event's selfie; a clock in / out without one gets a warning badge for review. */
export function ClockPhoto({ c, size = 36 }: { c: Pick<ClockEvent, 'kind' | 'photo' | 'noPhoto'>; size?: number }) {
  if (c.photo) return <img src={c.photo} alt="Clock photo" width={size} height={size} style={{ width: size, height: size, objectFit: 'cover', borderRadius: 8, flex: 'none', display: 'block' }} />;
  if (!missingPhoto(c)) return null;
  return <span title={c.noPhoto ?? 'No photo'}><Badge tone="warning"><Icon name="camera-off" size={12} />No photo{c.noPhoto && c.noPhoto !== 'No photo' ? ' · ' + c.noPhoto.toLowerCase() : ''}</Badge></span>;
}
