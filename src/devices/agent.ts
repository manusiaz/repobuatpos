'use client';
// Print agent: on the device that drives a printer, each newly fired order line prints once on its station printer, and
// a paid register sale prints its receipt when that printer has auto-print on. One tab per browser runs it (Web Locks);
// what was printed is remembered per device, so reloads and other tabs never print twice. Failures wait in the print queue.
import { useEffect, useState } from 'react';
import { snapshot, useDB } from '../data/store.ts';
import { keysOf, pendingJobs, prune, thisDevice, voidLines, type AgentState, type Job } from './routing.ts';
import { printReceipt, printTickets, type Result } from './hardware.ts';
import './testers.ts';

export interface Failed { job: Job; no: string; at: number; error: string }
type State = AgentState & { failed: Failed[] };
const KEY = (dev: string) => 'borniz-print-agent:' + dev;
const listeners = new Set<() => void>();
const memory = new Map<string, string>(); // storage blocked (private mode, locked-down kiosk browser): this tab remembers
function load(dev: string): State {
  let raw = memory.get(KEY(dev)) ?? null; try { raw = localStorage.getItem(KEY(dev)) ?? raw; } catch { /* blocked */ }
  try { const s = JSON.parse(raw || 'null') as State | null; if (s?.since) return { ...s, failed: s.failed ?? [] }; } catch { /* unreadable */ }
  const s = { since: Date.now(), done: {}, failed: [] }; save(dev, s); return s;
}
function save(dev: string, s: State) {
  prune(s);
  const raw = JSON.stringify(s); memory.set(KEY(dev), raw);
  try { localStorage.setItem(KEY(dev), raw); } catch { /* storage blocked: the memory copy above */ }
  listeners.forEach(f => f());
}
/** Change shown on the cash receipt: the register keeps it for the success screen (per tab, see screens/pos/shared uiGet). */
const lastChange = (orderId: string) => { try { const v = JSON.parse(sessionStorage.getItem('borniz-pos-ui') || '{}').lastPaid; return v?.id === orderId ? Number(v.change) || 0 : 0; } catch { return 0; } };

function runJob(j: Job): Promise<Result> {
  const db = snapshot(), o = db.orders.find(x => x.id === j.orderId);
  if (!o) return Promise.resolve({ ok: false, message: 'Order not found' });
  if (j.kind === 'void') return printTickets(db, { ...o, lines: voidLines(o, j.lineIds!) }, 'device', true, j.lineIds, 'Void - do not make');
  return j.kind === 'receipt' ? printReceipt(db, o, thisDevice(db, register), 'device', { change: lastChange(o.id) }) : printTickets(db, o, 'device', false, j.lineIds);
}

let chain: Promise<void> = Promise.resolve(), leader = false, asked = false, register = false;
async function work() {
  const db = snapshot(), dev = thisDevice(db, register);
  if (!dev || !db.integrations.some(i => i.kind === 'printer' && i.enabled)) return;
  const s0 = load(dev);
  for (const j of pendingJobs(db, dev, s0.done, s0.since)) {
    const o = db.orders.find(x => x.id === j.orderId)!, keys = keysOf(j, o), s = load(dev);
    if (keys.some(k => s.done[k])) continue;
    keys.forEach(k => { s.done[k] = Date.now(); }); save(dev, s); // claim before printing
    const r = await runJob(j);
    if (!r.ok) { const f = load(dev); f.failed = [{ job: j, no: o.no, at: Date.now(), error: r.message }, ...f.failed].slice(0, 50); save(dev, f); }
  }
}
const kick = () => { if (leader) chain = chain.then(work).catch(() => {}); };
function elect() {
  if (asked) return; asked = true;
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks) { leader = true; return; }
  locks.request('borniz-print-agent', () => { leader = true; kick(); return new Promise<void>(() => {}); }).catch(() => { leader = true; });
}

/** Mount once in the app shell. `on` = this surface may print (staff devices); `onRegister` = the register screen, which
 *  may stand in for the outlet's first register when this browser is not paired. */
export function usePrintAgent(on = true, onRegister = false) {
  const db = useDB();
  useEffect(() => { register = onRegister; if (on && db) { elect(); kick(); } }, [db, on, onRegister]);
}

/** Print queue of this device (failed jobs) for the Device page. */
export function usePrintQueue(dev: string | null) {
  const [, bump] = useState(0);
  useEffect(() => { const f = () => bump(n => n + 1); listeners.add(f); return () => { listeners.delete(f); }; }, []);
  if (!dev) return [];
  try { return (JSON.parse(localStorage.getItem(KEY(dev)) || memory.get(KEY(dev)) || 'null') as State | null)?.failed ?? []; } catch { return (JSON.parse(memory.get(KEY(dev)) || 'null') as State | null)?.failed ?? []; }
}
export async function retryFailed(dev: string): Promise<number> {
  const s = load(dev), jobs = s.failed; s.failed = []; save(dev, s);
  let left = 0;
  for (const f of jobs) { const r = await runJob(f.job); if (!r.ok) { left++; const x = load(dev); x.failed.push({ ...f, at: Date.now(), error: r.message }); save(dev, x); } }
  return left;
}
export function clearFailed(dev: string) { const s = load(dev); s.failed = []; save(dev, s); }
