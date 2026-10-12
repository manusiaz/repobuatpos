// Outgoing webhook events (the list the Settings → Webhooks page shows). Pure: also used by the connector form.
export const EVENTS = ['order.paid', 'payment.settled', 'item.86', 'approval.decided', 'publish.done', 'theme.published', 'menu.updated', 'price.changed'] as const;
export type EventName = typeof EVENTS[number] | 'ping';
export interface OutEvent { id: string; event: EventName; at: number; data: Record<string, unknown> }

/** Events a webhook-out integration subscribes to: the toggled ones, or all when none is toggled. */
export const subscribed = (config: Record<string, unknown>, e: EventName) =>
  e === 'ping' || !EVENTS.some(x => config['ev:' + x]) || Boolean(config['ev:' + e]);
