-- ============================================================
-- MMR v3 Migration — Missing tables referenced in code
-- Run in Supabase SQL Editor AFTER v2
-- ============================================================

-- ============================================================
-- 1. master_settings — platform-wide key/value config
-- ============================================================
create table if not exists public.master_settings (
  id            uuid primary key default uuid_generate_v4(),
  setting_key   text not null unique,
  setting_value text not null,
  updated_by    uuid references public.profiles(id),
  updated_at    timestamptz not null default now()
);

alter table public.master_settings enable row level security;

drop policy if exists "Authenticated can view master_settings" on public.master_settings;
drop policy if exists "Admins can manage master_settings" on public.master_settings;

create policy "Authenticated can view master_settings" on public.master_settings
  for select using (auth.role() = 'authenticated');

create policy "Admins can manage master_settings" on public.master_settings
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'super_admin'))
  );

insert into public.master_settings (setting_key, setting_value) values
  ('electricity_rate', '8'),
  ('water_rate', '0.05'),
  ('incentive_per_flat', '500'),
  ('incentive_bonus_threshold', '5'),
  ('incentive_bonus_amount', '1000')
on conflict (setting_key) do nothing;

-- ============================================================
-- 2. expense_groups — custom expense categories
-- ============================================================
create table if not exists public.expense_groups (
  id         uuid primary key default uuid_generate_v4(),
  name       text not null,
  icon       text default '📌',
  color      text default '#94a3b8',
  is_active  boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.expense_groups enable row level security;

drop policy if exists "Authenticated can view expense_groups" on public.expense_groups;
drop policy if exists "Admins can manage expense_groups" on public.expense_groups;

create policy "Authenticated can view expense_groups" on public.expense_groups
  for select using (auth.role() = 'authenticated');

create policy "Admins can manage expense_groups" on public.expense_groups
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'super_admin'))
  );

-- ============================================================
-- 3. meter_readings — electricity and water meter entries
--    Drop first to handle any partial previous creation
-- ============================================================
drop table if exists public.meter_readings cascade;

create table public.meter_readings (
  id               uuid primary key default uuid_generate_v4(),
  building_id      uuid references public.buildings(id) on delete cascade not null,
  flat_id          uuid references public.flats(id) on delete set null,
  tenant_id        uuid references public.tenants(id) on delete set null,
  reading_type     text not null check (reading_type in ('electricity', 'water')),
  previous_reading numeric(10,2) not null default 0,
  current_reading  numeric(10,2) not null,
  units_consumed   numeric(10,2) not null default 0,
  rate             numeric(10,4) not null default 0,
  amount_charged   numeric(10,2) not null default 0,
  for_month        text not null,
  reading_date     date not null default current_date,
  payment_mode     text check (payment_mode in ('cash', 'upi', 'bank_transfer', 'other')),
  collected_by     uuid references public.profiles(id),
  notes            text,
  created_at       timestamptz not null default now()
);

alter table public.meter_readings enable row level security;

create policy "Authenticated can view meter_readings" on public.meter_readings
  for select using (auth.role() = 'authenticated');

create policy "Authenticated can insert meter_readings" on public.meter_readings
  for insert with check (auth.role() = 'authenticated');

create policy "Authenticated can update meter_readings" on public.meter_readings
  for update using (auth.role() = 'authenticated');

create policy "Admins can delete meter_readings" on public.meter_readings
  for delete using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'super_admin'))
  );

create index idx_meter_readings_building on public.meter_readings(building_id);
create index idx_meter_readings_month    on public.meter_readings(for_month);
create index idx_meter_readings_tenant   on public.meter_readings(tenant_id);

-- ============================================================
-- 4. Add electricity/water reading toggle columns to buildings
-- ============================================================
alter table public.buildings
  add column if not exists electricity_reading_enabled boolean not null default false,
  add column if not exists water_reading_enabled       boolean not null default false;
