-- Treellis free-account usage. Run once in the Supabase dashboard: SQL Editor → New query → Run.
-- Accounts themselves live in Supabase Auth (auth.users); this table only counts generations.

create table if not exists public.generation_usage (
  user_id uuid primary key references auth.users (id) on delete cascade,
  used integer not null default 0,      -- generations counted against the free limit
  attempts integer not null default 0,  -- every run started, including refunded failures
  updated_at timestamptz not null default now()
);

-- Row level security with no policies: browsers (anon/authenticated) cannot read or change
-- counts. Only the Treellis server, using the secret key, calls the functions below.
alter table public.generation_usage enable row level security;

create or replace function public.claim_generation(p_user uuid, p_limit integer, p_attempt_limit integer)
returns table (allowed boolean, used_count integer, attempt_count integer)
language plpgsql security definer set search_path = public as $$
begin
  insert into generation_usage (user_id) values (p_user) on conflict (user_id) do nothing;
  return query
    with claimed as (
      update generation_usage g
         set used = g.used + 1, attempts = g.attempts + 1, updated_at = now()
       where g.user_id = p_user and g.used < p_limit and g.attempts < p_attempt_limit
      returning g.used, g.attempts
    )
    select true, claimed.used, claimed.attempts from claimed;
  if not found then
    return query select false, g.used, g.attempts from generation_usage g where g.user_id = p_user;
  end if;
end $$;

create or replace function public.refund_generation(p_user uuid)
returns void
language sql security definer set search_path = public as $$
  update generation_usage set used = greatest(used - 1, 0), updated_at = now() where user_id = p_user;
$$;

create or replace function public.generation_usage_for(p_user uuid)
returns table (allowed boolean, used_count integer, attempt_count integer)
language sql security definer set search_path = public as $$
  select true, coalesce(max(g.used), 0), coalesce(max(g.attempts), 0)
    from generation_usage g where g.user_id = p_user;
$$;

revoke all on function public.claim_generation(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.refund_generation(uuid) from public, anon, authenticated;
revoke all on function public.generation_usage_for(uuid) from public, anon, authenticated;
grant execute on function public.claim_generation(uuid, integer, integer) to service_role;
grant execute on function public.refund_generation(uuid) to service_role;
grant execute on function public.generation_usage_for(uuid) to service_role;
