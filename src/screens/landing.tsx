'use client';
// Marketing site (spec/BorNiz Landing). Rendered inside PublicShell (header with Pricing + footer from the registry).
// One view per landing page slug; product visuals are real BorNiz UI and live data, never stock photos.
import { useApp } from '../app/context.tsx';
import { NotFoundState } from './public/states-kit.tsx';
import { CaseStudies, Features, Hardware, Home, Integrations, Solutions } from './public/landing-home.tsx';
import { Contact, Pricing } from './public/landing-sales.tsx';
import { About, Article, Blog, Careers, Faq, Help, Legal } from './public/landing-content.tsx';
import { ApiDocs, SystemStatus } from './public/landing-dev.tsx';

export default function Screen() {
  const { page } = useApp();
  switch (page.slug) {
    case 'home': return <Home />;
    case 'features': return <Features />;
    case 'pricing': return <Pricing />;
    case 'contact-sales-book-a-demo': return <Contact />;
    case 'solutions-f-and-b': return <Solutions kind="fnb" />;
    case 'solutions-retail': return <Solutions kind="retail" />;
    case 'hardware-and-devices': return <Hardware />;
    case 'integrations-and-partners': return <Integrations />;
    case 'case-studies-and-testimonials': return <CaseStudies />;
    case 'blog-resources': return <Blog />;
    case 'blog-article': return <Article />;
    case 'faq': return <Faq />;
    case 'help-center-and-tutorials': return <Help />;
    case 'developer-api-docs': return <ApiDocs />;
    case 'system-status': return <SystemStatus />;
    case 'about-us': return <About />;
    case 'careers': return <Careers />;
    case 'terms-of-service': return <Legal doc="terms" />;
    case 'privacy-policy': return <Legal doc="privacy" />;
    case 'refund-policy': return <Legal doc="refund" />;
  }
  return <NotFoundState full={false} />;
}
