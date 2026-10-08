-- Additive infrastructure only: does not modify memories, profiles or Storage.
-- No texts, audio, locations or secrets are stored in the quota table.
begin;

create table if not exists public.mnemosine_api_usage (
  subject text not null,
  bucket text not null,
  window_start timestamptz not null,
  request_count integer not null check (request_count >= 0),
  primary key (subject, bucket, window_start)
);

alter table public.mnemosine_api_usage enable row level security;
revoke all on table public.mnemosine_api_usage from public, anon, authenticated;
grant all on table public.mnemosine_api_usage to service_role;

create or replace function public.mnemosine_consume_api_quota(p_user_id uuid, p_bucket text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  minute_limit integer;
  user_day_limit integer;
  project_day_limit integer;
  window_minute timestamptz := date_trunc('minute', now());
  window_day timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  item record;
  claimed integer;
begin
  if p_user_id is null then raise exception 'user required'; end if;
  -- Status verifies that the migration exists, without consuming paid API quota.
  if p_bucket = 'status' then return jsonb_build_object('allowed', true); end if;

  case p_bucket
    when 'google' then minute_limit := 120; user_day_limit := 1000; project_day_limit := 5000;
    when 'ai' then minute_limit := 10; user_day_limit := 150; project_day_limit := 500;
    when 'audio' then minute_limit := 2; user_day_limit := 30; project_day_limit := 100;
    else raise exception 'invalid bucket';
  end case;

  -- Global first, then user-day, then user-minute: consistent lock order.
  -- Atomic UPSERT prevents concurrent Edge isolates from bypassing the limits.
  -- A denied request may consume an earlier counter (conservative/fail-closed).
  for item in
    select * from (values
      (1, 'project', p_bucket || ':day', window_day, project_day_limit),
      (2, p_user_id::text, p_bucket || ':day', window_day, user_day_limit),
      (3, p_user_id::text, p_bucket || ':minute', window_minute, minute_limit)
    ) as limits(lock_order, subject, bucket, window_start, max_requests)
    order by lock_order
  loop
    claimed := null;
    insert into public.mnemosine_api_usage as usage (subject, bucket, window_start, request_count)
    values (item.subject, item.bucket, item.window_start, 1)
    on conflict (subject, bucket, window_start) do update
      set request_count = usage.request_count + 1
      where usage.request_count < item.max_requests
    returning request_count into claimed;
    if claimed is null then return jsonb_build_object('allowed', false); end if;
  end loop;

  return jsonb_build_object('allowed', true);
end;
$$;

-- Only the backend can consume quotas. A caller cannot reset/increase its counters.
revoke all on function public.mnemosine_consume_api_quota(uuid, text) from public, anon, authenticated;
grant execute on function public.mnemosine_consume_api_quota(uuid, text) to service_role;

commit;
