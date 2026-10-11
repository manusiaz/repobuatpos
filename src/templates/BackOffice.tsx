'use client';
// Every owner/manager/system page without its own screen renders here from the sitemap (Design Notes: Back office).
import { useApp } from '../app/context.tsx';
import { AuthorityPanel } from './common.tsx';
import List from './List.tsx';
import Detail from './Detail.tsx';
import Form from './Form.tsx';
import Report from './Report.tsx';
import Settings from './Settings.tsx';
import Flow from './Flow.tsx';
import { MessageTemplate, DeviceScreen } from './Template.tsx';

export default function BackOffice() {
  const { page } = useApp();
  const T = { list: List, detail: Detail, form: Form, report: Report, settings: Settings, flow: Flow, template: MessageTemplate, device: DeviceScreen }[page.template ?? 'list'];
  return <>
    <T key={page.path} />
    <AuthorityPanel />
  </>;
}
