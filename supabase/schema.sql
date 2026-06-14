create extension if not exists pgcrypto;

create table if not exists public.training_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan jsonb not null,
  inserted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

alter table public.training_plans enable row level security;

drop policy if exists "Users can read own training plan" on public.training_plans;
create policy "Users can read own training plan"
  on public.training_plans
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own training plan" on public.training_plans;
create policy "Users can insert own training plan"
  on public.training_plans
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own training plan" on public.training_plans;
create policy "Users can update own training plan"
  on public.training_plans
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_training_plans_updated_at on public.training_plans;
create trigger set_training_plans_updated_at
  before update on public.training_plans
  for each row
  execute function public.set_updated_at();
