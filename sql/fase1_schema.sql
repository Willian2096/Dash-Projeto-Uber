-- Applied via Supabase migration fase1_monthly_goals_and_daily_views.
-- Requires Fase 0 fuel_price/fuel_consumption columns. No existing rows are modified.
create table public.monthly_goals (
 user_id uuid not null references auth.users(id) on delete cascade,
 month date not null check(extract(day from month)=1),
 goal numeric not null default 0 check(goal>=0 and goal<'Infinity'::numeric),
 baseline numeric not null default 0 check(baseline>=0 and baseline<'Infinity'::numeric),
 primary key(user_id,month)
);
alter table public.monthly_goals enable row level security;
revoke all on public.monthly_goals from public,anon,authenticated;
grant select,insert,update,delete on public.monthly_goals to authenticated;
create policy monthly_goals_select_own on public.monthly_goals for select to authenticated using((select auth.uid())=user_id);
create policy monthly_goals_insert_own on public.monthly_goals for insert to authenticated with check((select auth.uid())=user_id);
create policy monthly_goals_update_own on public.monthly_goals for update to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy monthly_goals_delete_own on public.monthly_goals for delete to authenticated using((select auth.uid())=user_id);
create view public.driveup_daily_totals with(security_invoker=true) as
with rates as (
 select s.*,coalesce(s.fuel_price,case when jsonb_typeof(u.preferences#>'{fuelLegacyBaseline,price}')='number' then (u.preferences#>>'{fuelLegacyBaseline,price}')::numeric end,u.fuel_price,0) as used_price,
 coalesce(s.fuel_consumption,case when jsonb_typeof(u.preferences#>'{fuelLegacyBaseline,consumption}')='number' then (u.preferences#>>'{fuelLegacyBaseline,consumption}')::numeric end,u.confirmed_consumption,0) as used_consumption
 from public.sessions s left join public.user_settings u on u.user_id=s.user_id
), costs as (
 select *,case when used_consumption>0 and used_price>=0 then km/used_consumption*used_price else 0 end as fuel_cost,
 case when source='uber_pdf' then 0 else platform_expenses end as uber_cost from rates
)
select user_id,session_date,count(*)::integer as sessions,sum(gross+tip) as gross,sum(tip) as tip,sum(fuel_cost) as fuel,
 sum(gross+tip-fuel_cost-uber_cost) as net,sum(minutes)::integer as minutes,sum(km) as km,sum(trip_km) as trip_km,sum(rides)::integer as rides,
 count(*) filter(where source='manual')::integer as manual_sessions,count(*) filter(where source='uber_pdf')::integer as pdf_sessions
from costs group by user_id,session_date;
revoke all on public.driveup_daily_totals from public,anon,authenticated;
grant select on public.driveup_daily_totals to authenticated;
create view public.driveup_uber_day_totals with(security_invoker=true) as
with entries as (
 select user_id,coalesce(event_at,processed_at)::date as session_date,event_kind,earnings,
 case when extract(hour from coalesce(event_at,processed_at))<12 then 'Manhã' when extract(hour from coalesce(event_at,processed_at))<18 then 'Tarde' else 'Noite' end as period
 from public.uber_transactions where event_kind in ('service','adjustment') and earnings>0 and coalesce(event_at,processed_at) is not null
), per_period as (
 select user_id,session_date,period,sum(earnings) as earnings,count(*) filter(where event_kind='service')::integer as rides,
 coalesce(sum(earnings) filter(where event_kind='service'),0) as service_earnings,
 coalesce(sum(earnings) filter(where event_kind='adjustment'),0) as adjustments
 from entries group by user_id,session_date,period
)
select user_id,session_date,sum(earnings) as earnings,sum(rides)::integer as rides,sum(adjustments) as adjustments,
 (array_agg(period order by rides desc,case period when 'Manhã' then 1 when 'Tarde' then 2 else 3 end))[1] as period,
 jsonb_object_agg(period,jsonb_build_object('rides',rides,'gross',service_earnings)) as period_breakdown
from per_period group by user_id,session_date;
revoke all on public.driveup_uber_day_totals from public,anon,authenticated;
grant select on public.driveup_uber_day_totals to authenticated;
comment on table public.monthly_goals is 'Fase 1: one saved goal per user and month. Legacy JSON remains readable; no automatic migration.';
comment on view public.driveup_daily_totals is 'Fase 1: server-computed daily totals. Does not change session rows or odometer.';
notify pgrst,'reload schema';
