import type { Connector, Field } from '../types.ts';

// Senders for db.messages. The dispatcher (src/data/actions/dispatch.ts) sends queued rows through /api/messages/send,
// which uses the tenant's active connector for the channel.
const LANG: Field = { key: 'lang', label: 'Template language', type: 'select', options: [['id', 'Bahasa Indonesia (id)'], ['en', 'English (en)'], ['en_US', 'English US (en_US)']], help: 'The language the templates were approved in.' };

export const CONNECTORS: Connector[] = [
  { id: 'wa-simulator', kind: 'whatsapp', name: 'WhatsApp simulator', scope: 'tenant', runtime: 'server', ready: true, fields: [],
    blurb: 'Marks messages sent and delivered without contacting anyone. For training and demos.' },
  { id: 'meta-cloud', kind: 'whatsapp', name: 'WhatsApp Cloud API (Meta)', scope: 'tenant', runtime: 'server', ready: true, webhook: '/api/messages/webhook/meta-cloud', docs: 'https://developers.facebook.com/docs/whatsapp/cloud-api',
    blurb: 'Your own WhatsApp Business number through Meta. Sends approved templates; delivered and read ticks come back by webhook.',
    fields: [
      { key: 'phoneNumberId', label: 'Phone number ID', required: true, placeholder: '1234567890', help: 'WhatsApp Manager → API setup.' },
      { key: 'wabaId', label: 'WhatsApp Business account ID' },
      { key: 'version', label: 'Graph API version', placeholder: 'v21.0' },
      LANG,
      { key: 'accessToken', label: 'Permanent access token', type: 'secret', required: true, help: 'System user token with whatsapp_business_messaging permission.' },
      { key: 'appSecret', label: 'App secret', type: 'secret', help: 'Verifies the X-Hub-Signature-256 header on status webhooks.' },
      { key: 'verifyToken', label: 'Webhook verify token', type: 'secret', help: 'Any phrase; type the same one in the Meta webhook settings.' }] },
  { id: 'qontak', kind: 'whatsapp', name: 'Qontak', scope: 'tenant', runtime: 'server', ready: false, docs: 'https://docs.qontak.com',
    blurb: 'WhatsApp Business through Mekari Qontak (official provider).',
    fields: [{ key: 'channelIntegrationId', label: 'Channel integration ID', required: true }, LANG, { key: 'accessToken', label: 'Access token', type: 'secret', required: true }] },
  { id: 'wati', kind: 'whatsapp', name: 'Wati', scope: 'tenant', runtime: 'server', ready: false, docs: 'https://docs.wati.io',
    blurb: 'WhatsApp Business through Wati (official provider).',
    fields: [{ key: 'endpoint', label: 'API endpoint', type: 'url', required: true, placeholder: 'https://live-mt-server.wati.io/123456' }, LANG, { key: 'accessToken', label: 'Access token', type: 'secret', required: true }] },
  { id: 'fonnte', kind: 'whatsapp', name: 'Fonnte', scope: 'tenant', runtime: 'server', ready: false, docs: 'https://docs.fonnte.com',
    blurb: 'WhatsApp gateway on a connected phone (unofficial; no Meta templates).',
    fields: [{ key: 'device', label: 'Sender number', required: true, placeholder: '62812…' }, { key: 'token', label: 'Device token', type: 'secret', required: true }] },
  { id: 'email-simulator', kind: 'email', name: 'Email simulator', scope: 'tenant', runtime: 'server', ready: true, fields: [],
    blurb: 'Marks emails sent and delivered without sending. For training and demos.' },
  { id: 'resend', kind: 'email', name: 'Resend', scope: 'tenant', runtime: 'server', ready: true, docs: 'https://resend.com/docs/api-reference/emails/send-email',
    blurb: 'Receipts and campaigns from your own domain through the Resend email API.',
    fields: [
      { key: 'from', label: 'From', required: true, placeholder: 'Kopi Biru <struk@kopibiru.id>', help: 'The domain must be verified in Resend.' },
      { key: 'replyTo', label: 'Reply-to', placeholder: 'halo@kopibiru.id' },
      { key: 'apiKey', label: 'API key', type: 'secret', required: true, placeholder: 're_…' }] },
  { id: 'smtp', kind: 'email', name: 'SMTP server', scope: 'tenant', runtime: 'server', ready: false, docs: 'https://datatracker.ietf.org/doc/html/rfc5321',
    blurb: 'Any mail server (Google Workspace, Zoho, your web host).',
    fields: [
      { key: 'host', label: 'Host', required: true, placeholder: 'smtp.gmail.com' },
      { key: 'port', label: 'Port', type: 'number', required: true, placeholder: '587' },
      { key: 'secure', label: 'TLS from the start (port 465)', type: 'toggle' },
      { key: 'user', label: 'Username', required: true },
      { key: 'from', label: 'From', required: true },
      { key: 'password', label: 'Password', type: 'secret', required: true }] },
  { id: 'sms-simulator', kind: 'sms', name: 'SMS simulator', scope: 'tenant', runtime: 'server', ready: true, fields: [],
    blurb: 'Marks SMS sent without sending. For training and demos.' },
  { id: 'twilio', kind: 'sms', name: 'Twilio SMS', scope: 'tenant', runtime: 'server', ready: false, docs: 'https://www.twilio.com/docs/messaging/api/message-resource',
    blurb: 'OTP and fallback SMS through Twilio.',
    fields: [{ key: 'accountSid', label: 'Account SID', required: true }, { key: 'from', label: 'Sender number or ID', required: true }, { key: 'authToken', label: 'Auth token', type: 'secret', required: true }] },
];
