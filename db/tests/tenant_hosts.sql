-- <slug>.bornis.id: platform host names are never a business.
do $$ begin
  begin insert into public.tenants (name, slug) values ('Evil', 'pos'); raise exception 'reserved slug accepted';
  exception when check_violation then null; end;
  begin insert into public.tenants (name, slug) values ('Evil', 'admin'); raise exception 'reserved slug accepted';
  exception when check_violation then null; end;
  insert into public.tenants (name, slug) values ('Warung Bu Sri', 'warung-bu-sri');
  delete from public.tenants where slug = 'warung-bu-sri';
end $$;
select 'tenant hosts hold';
