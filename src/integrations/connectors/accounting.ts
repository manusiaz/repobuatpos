import type { Connector, Field } from '../types.ts';

// Journal CSV works today (src/integrations/server/accounting/journal.ts, same sales math as the dashboards).
// Jurnal.id and Accurate need their OAuth apps: the settings are kept until the drivers ship.
const acct = (key: string, label: string, placeholder: string): Field => ({ key, label, placeholder, help: 'Account code in your chart of accounts.' });
export const JOURNAL_ACCOUNTS: Field[] = [
  acct('acc_cash', 'Cash', '1-1001'), acct('acc_qris', 'QRIS clearing', '1-1102'), acct('acc_card', 'Card (EDC) clearing', '1-1103'),
  acct('acc_ewallet', 'E-wallet / delivery app clearing', '1-1104'), acct('acc_va', 'Virtual account clearing', '1-1105'),
  acct('acc_deposit', 'Customer deposits', '2-1201'), acct('acc_kasbon', 'Receivables (kasbon)', '1-1301'),
  acct('acc_sales', 'Sales', '4-1001'), acct('acc_discount', 'Sales discounts', '4-1901'), acct('acc_service', 'Service charge', '4-2001'),
  acct('acc_tax', 'PB1 tax payable', '2-1301'), acct('acc_refund', 'Sales returns', '4-1902'), acct('acc_rounding', 'Rounding', '7-1001'),
];
const oauth = (name: string): Field => ({ key: 'redirect', label: 'OAuth redirect URL', type: 'url', placeholder: '/api/accounting/oauth/…', help: `Sign-in with ${name} opens here once the driver ships; until then nothing is sent.` });

export const CONNECTORS: Connector[] = [
  { id: 'journal-csv', kind: 'accounting', name: 'Journal export (CSV)', scope: 'tenant', runtime: 'browser', ready: true,
    blurb: 'Daily journal per outlet: sales, discounts, service, PB1, payments per method, refunds. Imports into any accounting app.',
    fields: JOURNAL_ACCOUNTS },
  { id: 'jurnal', kind: 'accounting', name: 'Jurnal.id', scope: 'tenant', runtime: 'server', ready: false, docs: 'https://api-doc.jurnal.id',
    blurb: 'Posts the daily sales journal and purchase bills to Jurnal by Mekari.',
    fields: [{ key: 'clientId', label: 'Client ID (Mekari developer)', required: true }, { key: 'clientSecret', label: 'Client secret', type: 'secret', required: true }, oauth('Jurnal'), ...JOURNAL_ACCOUNTS] },
  { id: 'accurate', kind: 'accounting', name: 'Accurate Online', scope: 'tenant', runtime: 'server', ready: false, docs: 'https://account.accurate.id/developer/api-docs.do',
    blurb: 'Posts the daily sales journal to your Accurate Online database.',
    fields: [{ key: 'databaseId', label: 'Database ID', required: true }, { key: 'clientId', label: 'Client ID', required: true }, { key: 'clientSecret', label: 'Client secret', type: 'secret', required: true },
      { key: 'signatureSecret', label: 'Signature secret', type: 'secret', required: true }, oauth('Accurate'), ...JOURNAL_ACCOUNTS] },
];
