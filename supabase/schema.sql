-- Supabase Auth issues and refreshes the signed JWT used by the client.
create table if not exists public.user_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_data enable row level security;

drop policy if exists "Users can read their own data" on public.user_data;
drop policy if exists "Users can insert their own data" on public.user_data;
drop policy if exists "Users can update their own data" on public.user_data;

create policy "Users can read their own data"
  on public.user_data for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Users can insert their own data"
  on public.user_data for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "Users can update their own data"
  on public.user_data for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update on public.user_data to authenticated;
