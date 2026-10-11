// Route plumbing: one error type, JSON answers, and a wrapper that never leaks stack traces or secrets.
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try { return (await req.json()) as T; } catch { throw new HttpError(400, 'Body must be JSON'); }
}
export function handle<A extends unknown[]>(fn: (...a: A) => Promise<Response>) {
  return async (...a: A): Promise<Response> => {
    try { return await fn(...a); } catch (e) {
      const status = (e as { status?: number }).status ?? 500;
      if (status >= 500 && status !== 501 && status !== 502 && status !== 503) console.error('[api]', (e as Error).name);
      return json({ ok: false, message: status === 500 ? 'Server error' : (e as Error).message }, status);
    }
  };
}
