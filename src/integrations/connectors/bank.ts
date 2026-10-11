import type { Connector } from '../types.ts';

const BANKS: [string, string][] = [['bca', 'BCA'], ['mandiri', 'Mandiri'], ['bni', 'BNI'], ['bri', 'BRI'], ['cimb', 'CIMB Niaga'], ['permata', 'Permata'], ['bsi', 'BSI'], ['jago', 'Bank Jago'], ['other', 'Other']];

export const CONNECTORS: Connector[] = [
  { id: 'payout-account', kind: 'bank', name: 'Settlement bank account', scope: 'outlet', runtime: 'server', ready: false, docs: 'https://docs.xendit.co/payouts',
    blurb: 'Where gateway balances (QRIS, VA, e-wallet) are paid out, per outlet. Payout scheduling runs through the payment gateway once connected.',
    fields: [
      { key: 'bank', label: 'Bank', type: 'select', options: BANKS, required: true },
      { key: 'accountNo', label: 'Account number', required: true },
      { key: 'accountName', label: 'Account holder name', required: true, help: 'Must match the bank record exactly.' },
      { key: 'schedule', label: 'Payout schedule', type: 'select', options: [['daily', 'Daily'], ['weekly', 'Weekly (Monday)'], ['manual', 'Manual']] },
      { key: 'minAmount', label: 'Minimum payout (Rp)', type: 'number', placeholder: '100000' }] },
  { id: 'bank-statement', kind: 'bank', name: 'Bank statement feed', scope: 'tenant', runtime: 'server', ready: false, docs: 'https://developer.bca.co.id',
    blurb: 'Pulls mutations to reconcile settlements and cash drops against bank deposits.',
    fields: [
      { key: 'bank', label: 'Bank', type: 'select', options: BANKS, required: true },
      { key: 'accountNo', label: 'Account number', required: true },
      { key: 'corporateId', label: 'Corporate ID' },
      { key: 'clientId', label: 'API client ID', required: true },
      { key: 'clientSecret', label: 'API client secret', type: 'secret', required: true },
      { key: 'apiKey', label: 'API key', type: 'secret' }] },
];
