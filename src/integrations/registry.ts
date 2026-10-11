// The one list of connectors. Each kind lives in its own file under connectors/.
import type { Connector, Kind } from './types.ts';
import { CONNECTORS as payment } from './connectors/payment.ts';
import { CONNECTORS as devices } from './connectors/devices.ts';
import { CONNECTORS as messaging } from './connectors/messaging.ts';
import { CONNECTORS as delivery } from './connectors/delivery.ts';
import { CONNECTORS as accounting } from './connectors/accounting.ts';
import { CONNECTORS as webhook } from './connectors/webhook.ts';
import { CONNECTORS as bank } from './connectors/bank.ts';
import { CONNECTORS as courier } from './connectors/courier.ts';

export const CONNECTORS: Connector[] = [...payment, ...devices, ...messaging, ...delivery, ...accounting, ...webhook, ...bank, ...courier];
export const connector = (id: string) => CONNECTORS.find(c => c.id === id);
export const connectorsOf = (...kinds: Kind[]) => CONNECTORS.filter(c => kinds.includes(c.kind));
