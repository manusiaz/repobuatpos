// Catalog names for alerts the service layer raises at the moment of the event (no sweep delay).
// actions.ts requestApproval / decide use these so the notice carries the catalog name, recipients and on/off setting.
import type { RequestType } from '../../domain/approval.ts';

export function approvalAlert(type: RequestType, amount = 0, payload?: Record<string, unknown>): string {
  switch (type) {
    case 'discount': case 'void': return 'Discount / void / refund request';
    case 'refund': return amount > 500_000 ? 'Refund over IDR 500k' : 'Discount / void / refund request';
    case 'price': return 'Price change request';
    case 'local_item': return 'Local menu item waiting';
    case 'publish': case 'promo': return 'Publish waiting';
    case 'opname': return 'Opname waiting to sign';
    case 'variance': return 'Cash variance';
    case 'perm': return payload?.kind === 'support_access' ? 'Support access requested' : 'Approval needed';
    default: return 'Approval needed';
  }
}
export const decidedAlert = (type: RequestType) => (type === 'leave' ? 'Swap / leave decided' : type === 'po' ? 'PO approved / rejected' : 'Approval decided');
