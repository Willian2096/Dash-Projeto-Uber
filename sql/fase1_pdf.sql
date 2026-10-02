-- Applied via Supabase migration fase1_atomic_pdf_import. Defining this API does not import any data.
create function public.driveup_import_pdf_v1(p_transactions jsonb,p_days jsonb,p_file_name text,p_report_start timestamp,p_report_end timestamp,p_allow_overlap boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare uid uuid:=auth.uid(); d jsonb; day_date date; existing public.sessions%rowtype; daily record; inserted integer:=0; new_earnings numeric:=0; total_found integer; out_sessions jsonb:='[]'::jsonb;
begin
 if uid is null then raise exception 'Autenticação necessária.' using errcode='42501'; end if;
 if jsonb_typeof(p_transactions) is distinct from 'array' or jsonb_typeof(p_days) is distinct from 'array' then raise exception 'Importação inválida.'; end if;
 if jsonb_array_length(p_transactions)>10000 or jsonb_array_length(p_days)>366 then raise exception 'Importe um período menor.'; end if;
 if p_report_start is null or p_report_end is null or p_report_start>p_report_end then raise exception 'Período inválido.'; end if;
 if (select count(*) from jsonb_array_elements(p_days))<>(select count(distinct x->>'date') from jsonb_array_elements(p_days) x) then raise exception 'Dia repetido no complemento.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text,20261002));
 for d in select value from jsonb_array_elements(p_days) loop
  day_date:=(d->>'date')::date;
  if day_date is null then raise exception 'Dia inválido.'; end if;
  if coalesce((d->>'km')::numeric,-1)<0 or coalesce((d->>'trip_km')::numeric,-1)<0 or (d->>'trip_km')::numeric>(d->>'km')::numeric or coalesce((d->>'minutes')::integer,-1)<0 or coalesce((d->>'tip')::numeric,-1)<0 then raise exception 'Quilômetros, tempo ou gorjeta inválidos.'; end if;
  if (d->>'km')::numeric>100000 or (d->>'tip')::numeric>10000000 or (d->>'fuel_price')::numeric<0 or (d->>'fuel_price')::numeric>10000 or (d->>'fuel_consumption')::numeric<0 or (d->>'fuel_consumption')::numeric>10000 then raise exception 'Valores fora do limite permitido.'; end if;
  if not coalesce(p_allow_overlap,false) and exists(select 1 from public.sessions where user_id=uid and session_date=day_date and source='manual') then raise exception 'Já há uma sessão manual neste dia. Confirme a sobreposição antes de importar.'; end if;
  select * into existing from public.sessions where user_id=uid and source='uber_pdf' and source_key='uber:'||day_date::text for update;
  if found then
   if (d->>'expected_updated_at') is null or existing.updated_at is distinct from (d->>'expected_updated_at')::timestamptz then raise exception 'Conflito: a sessão mudou em outro acesso. Recarregue e confira o dia.'; end if;
  elsif d->>'expected_updated_at' is not null then raise exception 'Conflito: a sessão foi removida. Recarregue antes de reimportar.';
  end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p_transactions) x where nullif(x->>'fingerprint','') is null or nullif(x->>'event_label','') is null or coalesce(x->>'event_at',x->>'processed_at') is null or (x->>'event_kind') not in ('service','adjustment','expense','transfer','other')) then raise exception 'Transação inválida.'; end if;
 if exists(select 1 from jsonb_array_elements(p_transactions) x where abs(coalesce((x->>'earnings')::numeric,0))>100000000 or abs(coalesce((x->>'expense')::numeric,0))>100000000 or abs(coalesce((x->>'transfer')::numeric,0))>100000000) then raise exception 'Valor de transação inválido.'; end if;
 if exists(select 1 from jsonb_array_elements(p_transactions) x where x->>'event_kind' in ('service','adjustment') and (x->>'earnings')::numeric>0 and not exists(select 1 from jsonb_array_elements(p_days) y where (y->>'date')::date=coalesce((x->>'event_at')::timestamp,(x->>'processed_at')::timestamp)::date)) then raise exception 'Falta complemento de um dia do relatório.'; end if;
 with added as (
  insert into public.uber_transactions(user_id,fingerprint,processed_at,event_at,event_label,event_kind,service_type,earnings,expense,transfer,balance,report_start,report_end,source_file)
  select uid,x.fingerprint,x.processed_at,x.event_at,x.event_label,x.event_kind,x.service_type,coalesce(x.earnings,0),coalesce(x.expense,0),coalesce(x.transfer,0),x.balance,p_report_start,p_report_end,p_file_name
  from jsonb_to_recordset(p_transactions) as x(fingerprint text,processed_at timestamp,event_at timestamp,event_label text,event_kind text,service_type text,earnings numeric,expense numeric,transfer numeric,balance numeric)
  on conflict(user_id,fingerprint) do nothing returning earnings,event_kind
 ) select count(*)::integer,coalesce(sum(earnings) filter(where event_kind='service' and earnings>0),0) into inserted,new_earnings from added;
 for d in select value from jsonb_array_elements(p_days) loop
  day_date:=(d->>'date')::date;
  select * into daily from public.driveup_uber_day_totals where user_id=uid and session_date=day_date;
  if not found then raise exception 'Nenhuma entrada positiva para o dia informado.'; end if;
  select * into existing from public.sessions where user_id=uid and source='uber_pdf' and source_key='uber:'||day_date::text;
  if found then
   update public.sessions set gross=daily.earnings,rides=daily.rides,period=daily.period,period_breakdown=daily.period_breakdown,
    tip=(d->>'tip')::numeric,minutes=(d->>'minutes')::integer,km=(d->>'km')::numeric,trip_km=(d->>'trip_km')::numeric,
    fuel_price=coalesce(existing.fuel_price,(d->>'fuel_price')::numeric),fuel_consumption=coalesce(existing.fuel_consumption,(d->>'fuel_consumption')::numeric),platform_expenses=0
   where id=existing.id and user_id=uid returning * into existing;
  else
   insert into public.sessions(user_id,session_date,period,strategy_key,gross,tip,minutes,rides,km,trip_km,source,source_key,period_breakdown,fuel_price,fuel_consumption,note)
   values(uid,day_date,daily.period,coalesce(nullif(d->>'strategy_key',''),'seletiva'),daily.earnings,(d->>'tip')::numeric,(d->>'minutes')::integer,daily.rides,(d->>'km')::numeric,(d->>'trip_km')::numeric,'uber_pdf','uber:'||day_date::text,daily.period_breakdown,(d->>'fuel_price')::numeric,(d->>'fuel_consumption')::numeric,'Importado da Uber. Total diário consolidado pelo banco. Hodômetro manual preservado.') returning * into existing;
  end if;
  out_sessions:=out_sessions||jsonb_build_array(to_jsonb(existing));
 end loop;
 total_found:=jsonb_array_length(p_transactions);
 insert into public.uber_imports(user_id,file_name,report_start,report_end,transactions_found,new_transactions,duplicate_transactions,new_service_earnings)
 values(uid,p_file_name,p_report_start,p_report_end,total_found,inserted,total_found-inserted,new_earnings);
 return jsonb_build_object('sessions',out_sessions,'new_transactions',inserted,'duplicate_transactions',total_found-inserted);
end;
$$;
revoke all on function public.driveup_import_pdf_v1(jsonb,jsonb,text,timestamp,timestamp,boolean) from public,anon;
grant execute on function public.driveup_import_pdf_v1(jsonb,jsonb,text,timestamp,timestamp,boolean) to authenticated;
notify pgrst,'reload schema';
