-- Every business lives at <slug>.bornis.id (owner decision Oct 2026). A slug can never be one of the platform's
-- own hosts; the same list is RESERVED in src/system/hosts.ts.
alter table public.tenants drop constraint if exists tenants_slug_not_reserved;
alter table public.tenants add constraint tenants_slug_not_reserved check (slug not in
  ('www', 'app', 'pos', 'kds', 'display', 'order', 'admin', 'go', 'status', 'preview', 'menu', 'mail', 'api', 'cdn', 'static', 'help', 'docs', 'blog'));
