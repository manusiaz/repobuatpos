-- Fingerprint / face attendance machines (ZKTeco "ADMS" cloud push, /iclock/*). The machine only knows its serial number,
-- so the serial names the business: exactly one enabled 'attendance-zkteco' connection may claim it. Machine user IDs map
-- to employees through the connection's config ("user.<id>": employeeId). Each scan becomes one clock record (append-only,
-- id from serial + user + time so a re-sent batch is a no-op). Empty p_rows = handshake: only marks the machine as seen.
create or replace function public.bn_machine_clock(p_secret text, p_sn text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare tid uuid; integ jsonb; n int; r jsonb; emp text; outlet text; at bigint; k text; lastk text; st int; cid text;
  saved int := 0; unknown text[] := '{}'; tz text;
begin
  if not private.server_secret_ok(p_secret) then raise exception 'BN016 Bad server secret'; end if;
  select count(*) into n from public.docs where coll = 'integrations' and data->>'connector' = 'attendance-zkteco'
    and coalesce((data->>'enabled')::boolean, false) and data->'config'->>'serial' = p_sn;
  if n = 0 then raise exception 'BN060 Unknown machine %: add it in Devices › Connect a device', p_sn; end if;
  if n > 1 then raise exception 'BN061 Serial % is claimed by more than one connection', p_sn; end if;
  select tenant_id, data into tid, integ from public.docs where coll = 'integrations' and data->>'connector' = 'attendance-zkteco'
    and coalesce((data->>'enabled')::boolean, false) and data->'config'->>'serial' = p_sn;
  outlet := integ->>'outletId';
  if outlet is null then raise exception 'BN062 The machine connection has no outlet'; end if;
  tz := coalesce(nullif(integ->'config'->>'tz', ''), '+07:00');

  for r in select x from jsonb_array_elements(coalesce(p_rows, '[]')) x order by x->>'time' loop
    emp := integ->'config'->>('user.' || (r->>'pin'));
    if emp is null then -- kept in the audit trail so the scan can be entered by hand once the ID is linked
      unknown := array_append(unknown, r->>'pin');
      insert into public.audit_log (tenant_id, actor, action, subject, outlet_id, user_id) values (tid, 'server', 'clock.machine_unlinked', p_sn || ' · user ' || (r->>'pin') || ' · ' || (r->>'time'), outlet, null);
      continue;
    end if;
    at := (extract(epoch from ((r->>'time') || ' ' || tz)::timestamptz) * 1000)::bigint;
    cid := 'zk' || left(md5(p_sn || '|' || (r->>'pin') || '|' || (r->>'time')), 20);
    continue when exists (select 1 from public.docs where tenant_id = tid and coll = 'clock' and id = cid);
    st := coalesce(nullif(r->>'status', '')::int, 0);
    if st in (1, 5) then k := 'out'; elsif st = 2 then k := 'break'; elsif st = 3 then k := 'in';
    else -- machines without check-in/out keys send 0 for every scan: alternate in → out within one shift (16 h)
      select data->>'kind' into lastk from public.docs where tenant_id = tid and coll = 'clock' and data->>'employeeId' = emp
        and data->>'outletId' = outlet and t < at and t > at - 16 * 3600000 order by t desc limit 1;
      k := case when lastk = 'in' then 'out' else 'in' end;
    end if;
    insert into public.docs (tenant_id, coll, id, data, t, open, updated_by) values (tid, 'clock', cid,
      jsonb_build_object('id', cid, 'employeeId', emp, 'outletId', outlet, 'kind', k, 'at', at, 'noPhoto', 'Verified on ' || (integ->>'name')), at, false, null);
    saved := saved + 1;
  end loop;

  update public.docs set data = data || jsonb_build_object('status', 'ok', 'lastOk', (extract(epoch from now()) * 1000)::bigint,
      'lastError', case when cardinality(unknown) > 0 then 'Scans from machine users not linked to staff: ' || array_to_string(array(select distinct u from unnest(unknown) u), ', ')
        || '. Link them in Connect a device; the scans are in the activity log.' else data->>'lastError' end), -- stays until the connection is saved again
    updated_at = now(), updated_by = null
  where tenant_id = tid and coll = 'integrations' and id = integ->>'id';
  if saved > 0 then insert into public.audit_log (tenant_id, actor, action, subject, outlet_id, user_id) values (tid, 'server', 'clock.machine', p_sn || ' · ' || saved, outlet, null); end if;
  return jsonb_build_object('saved', saved, 'unknown', to_jsonb(unknown));
end $$;

revoke execute on function public.bn_machine_clock(text, text, jsonb) from public;
grant execute on function public.bn_machine_clock(text, text, jsonb) to anon, authenticated;
