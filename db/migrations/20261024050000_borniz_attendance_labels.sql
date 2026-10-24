-- Attendance labels (review of 20261020050000): Fingerspot also sends ZKTeco's English labels, and "Break Out" (a break
-- starts) was read as leaving and "Break In" / "Kembali Istirahat" (back from it) as a break, cutting the hours worked.
create or replace function public.bn_machine_clock(p_secret text, p_sn text, p_rows jsonb, p_key text default null, p_ip text default null) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare tid uuid; integ jsonb; n int; r jsonb; emp text; outlet text; at bigint; k text; lastk text; st int; cid text;
  saved int := 0; unknown text[] := '{}'; tz text; skipped int := 0; offclock int := 0; e jsonb; lbl text;
begin
  if not private.server_secret_ok(p_secret) then raise exception 'BN016 Bad server secret'; end if;
  select count(*) into n from public.docs where coll = 'integrations' and data->>'connector' in ('attendance-zkteco', 'attendance-fingerspot')
    and coalesce((data->>'enabled')::boolean, false) and data->'config'->>'serial' = p_sn;
  if n = 0 then raise exception 'BN060 Unknown machine %: add it in Devices › Connect a device', p_sn; end if;
  if n > 1 then raise exception 'BN061 Serial % is claimed by more than one connection', p_sn; end if;
  select tenant_id, data into tid, integ from public.docs where coll = 'integrations' and data->>'connector' in ('attendance-zkteco', 'attendance-fingerspot')
    and coalesce((data->>'enabled')::boolean, false) and data->'config'->>'serial' = p_sn;
  if coalesce(integ->'config'->>'key', '') <> '' and p_key is distinct from integ->'config'->>'key' then raise exception 'BN063 Wrong key for machine %', p_sn; end if;
  -- the serial is printed on the machine: an outlet can pin it to its own internet address
  if coalesce(integ->'config'->>'ip', '') <> '' and p_ip is distinct from integ->'config'->>'ip' then raise exception 'BN065 Machine % is only accepted from its outlet''s network', p_sn; end if;
  outlet := integ->>'outletId';
  if outlet is null then raise exception 'BN062 The machine connection has no outlet'; end if;
  tz := coalesce(nullif(integ->'config'->>'tz', ''), '+07:00');

  for r in select x from jsonb_array_elements(coalesce(p_rows, '[]')) x order by x->>'time' loop
   begin -- one bad row is skipped, never the batch: the machine resends a refused batch forever
    emp := integ->'config'->>('user.' || (r->>'pin'));
    if emp is null then -- kept in the audit trail so the scan can be entered by hand once the ID is linked
      unknown := array_append(unknown, r->>'pin');
      insert into public.audit_log (tenant_id, actor, action, subject, outlet_id, user_id) values (tid, 'server', 'clock.machine_unlinked', p_sn || ' · user ' || (r->>'pin') || ' · ' || (r->>'time'), outlet, null);
      continue;
    end if;
    e := private.doc(tid, 'employees', emp);
    if e is null or (e->>'active') = 'false' then skipped := skipped + 1; continue; end if; -- resigned: the finger still works, the job doesn't
    at := (extract(epoch from ((r->>'time') || ' ' || tz)::timestamptz) * 1000)::bigint;
    -- a machine whose clock is wrong (dead battery, factory time zone) or a forged backdated scan: not attendance
    if at < (extract(epoch from now() - interval '35 days') * 1000)::bigint or at > (extract(epoch from now() + interval '10 minutes') * 1000)::bigint then
      skipped := skipped + 1; offclock := offclock + 1; continue;
    end if;
    cid := 'zk' || left(md5(p_sn || '|' || (r->>'pin') || '|' || (r->>'time')), 20);
    continue when exists (select 1 from public.docs where tenant_id = tid and coll = 'clock' and id = cid);
    lbl := lower(coalesce(r->>'status', ''));
    st := case when lbl ~ '^\d+$' then lbl::int -- ZKTeco: 0 in / alternate, 1 out, 2 break, 3 back, 4-5 overtime
      -- Fingerspot labels, Indonesian or ZKTeco's English: the end of a break before the break, the break before leaving
      when lbl ~ '(kembali|break in|back)' then 3 when lbl ~ '(istirahat|break)' then 2 when lbl ~ '(keluar|pulang|out)' then 1 when lbl ~ '(masuk|in)' then 3
      else 0 end; -- an unknown label still counts as a scan: in / out by turns
    if st in (1, 5) then k := 'out'; elsif st = 2 then k := 'break'; elsif st = 3 then k := 'in';
    else -- machines without check-in/out keys send 0 for every scan: alternate in → out within one shift (16 h)
      select data->>'kind' into lastk from public.docs where tenant_id = tid and coll = 'clock' and data->>'employeeId' = emp
        and data->>'outletId' = outlet and t < at and t > at - 16 * 3600000 order by t desc limit 1;
      k := case when lastk = 'in' then 'out' else 'in' end;
    end if;
    insert into public.docs (tenant_id, coll, id, data, t, open, updated_by) values (tid, 'clock', cid,
      jsonb_build_object('id', cid, 'employeeId', emp, 'outletId', outlet, 'kind', k, 'at', at, 'noPhoto', 'Verified on ' || (integ->>'name')), at, false, null)
    on conflict do nothing; -- the same batch sent twice at once
    if found then saved := saved + 1; end if;
   exception when data_exception then skipped := skipped + 1; -- an impossible date or time in the row
   end;
  end loop;

  update public.docs set data = data || jsonb_build_object('status', 'ok', 'lastOk', (extract(epoch from now()) * 1000)::bigint,
      'lastError', case when offclock > 0 then offclock || ' scans have a date the machine cannot be right about. Set the machine''s date and time (Menu › System › Date/Time).'
        when cardinality(unknown) > 0 then 'Scans from machine users not linked to staff: ' || array_to_string(array(select distinct u from unnest(unknown) u), ', ')
        || '. Link them in Connect a device; the scans are in the activity log.' else data->>'lastError' end), -- stays until the connection is saved again
    updated_at = now(), updated_by = null
  where tenant_id = tid and coll = 'integrations' and id = integ->>'id'
    -- a machine polls every few seconds: "seen" is written at most once a minute when there is nothing new
    and (jsonb_array_length(coalesce(p_rows, '[]')) > 0 or coalesce((integ->>'lastOk')::bigint, 0) < (extract(epoch from now() - interval '1 minute') * 1000)::bigint);
  if saved > 0 then insert into public.audit_log (tenant_id, actor, action, subject, outlet_id, user_id) values (tid, 'server', 'clock.machine', p_sn || ' · ' || saved, outlet, null); end if;
  return jsonb_build_object('saved', saved, 'skipped', skipped, 'unknown', to_jsonb(unknown), 'tz', tz);
end $$;
revoke execute on function public.bn_machine_clock(text, text, jsonb, text, text) from public;
grant execute on function public.bn_machine_clock(text, text, jsonb, text, text) to anon, authenticated;
