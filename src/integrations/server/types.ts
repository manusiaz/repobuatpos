// Shared by every server driver: what a driver gets (config from the integration row + secrets from the private store).
export interface Ctx { config: Record<string, unknown>; secrets: Record<string, string>; fetch?: typeof fetch }
export type Headers = { get(name: string): string | null };
export interface TestResult { ok: boolean; message: string }

/** Thrown by a connector whose container is ready but whose API driver is not written yet. */
export class NotConnected extends Error {
  status = 501;
  constructor(name: string) { super(`${name} is not connected yet: the settings are saved, the API driver is still to be written.`); }
}
/** A provider answered with an error (message is safe to show: never contains secrets). */
export class ProviderError extends Error { status = 502; }

export const str = (v: unknown, d = '') => (typeof v === 'string' && v ? v : d);
export const need = (ctx: Ctx, ...keys: string[]) => {
  const miss = keys.find(k => !ctx.secrets[k] && !str(ctx.config[k]));
  if (miss) throw new ProviderError(`Missing setting: ${miss}`);
};
