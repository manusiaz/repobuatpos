// Staff sessions on the server: the PIN sign-in returns a server token for that person on this device (bn_staff_login).
// Every write carries the token of whoever is acting, so the server knows the real person and role. Per tab, like the session.
const KEY = 'borniz-staff';
type Tokens = { by: Record<string, string>; last: string | null };
const read = (): Tokens => { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null') ?? { by: {}, last: null }; } catch { return { by: {}, last: null }; } };
const write = (t: Tokens) => { try { sessionStorage.setItem(KEY, JSON.stringify(t)); } catch { /* blocked: this tab only */ } };

export function setStaffToken(employeeId: string, token: string) { const t = read(); t.by[employeeId] = token; t.last = token; write(t); }
/** The acting person's token; an approver deciding on someone else's register writes under the signed-in person's session. */
export const staffToken = (employeeId: string): string | null => { const t = read(); return t.by[employeeId] ?? t.last; };
/** This person's own PIN session on this device, if they signed in by PIN (none: they act as the account). */
export const ownStaffToken = (employeeId: string): string | null => read().by[employeeId] ?? null;
export function clearStaffTokens() { const t = read(); try { sessionStorage.removeItem(KEY); } catch { /* blocked */ } return Object.values(t.by); }
