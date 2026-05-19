-- ============================================================
-- MMR v2 Migration — Run in Supabase SQL Editor
-- Apply once on the live project (emgzzalsyxdxmpnhsmab)
-- ============================================================

-- ============================================================
-- 1. Add is_platform_admin to profiles
--    Required for Platform Admin separation
-- ============================================================
alter table public.profiles
  add column if not exists is_platform_admin boolean not null default false;

-- Only one person should be platform admin; document that here
comment on column public.profiles.is_platform_admin is
  'True only for Rent N Stay platform owner. Controls access to the separate Platform Admin app.';

-- ============================================================
-- 2. Prevent duplicate rent payments for same tenant+month
-- ============================================================
-- Drop if it already exists so this script is re-runnable
alter table public.rent_collections
  drop constraint if exists rent_collections_tenant_month_unique;

alter table public.rent_collections
  add constraint rent_collections_tenant_month_unique
  unique (tenant_id, for_month);

-- ============================================================
-- 3. Dedicated checkout columns on tenants
--    Replaces the pipe-delimited checkout data stuffed into notes
-- ============================================================
alter table public.tenants
  add column if not exists exit_type         text check (exit_type in ('normal', 'early', 'eviction', 'abandonment')),
  add column if not exists exit_deductions   numeric(10,2) default 0,
  add column if not exists exit_net_refund   numeric(10,2) default 0,
  add column if not exists exit_reason       text,
  add column if not exists exit_notes        text;

-- ============================================================
-- 4. Tighten RLS write policies — require admin/super_admin role
--    for sensitive tables (buildings, flats, tenants, rent_collections)
-- ============================================================

-- BUILDINGS: anyone authenticated can currently do everything — restrict writes
drop policy if exists "Authenticated users can manage buildings" on public.buildings;

create policy "Admins can write buildings" on public.buildings
  for insert with check (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'super_admin'))
  );
create policy "Admins can update buildings" on public.buildings
  for update using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'super_admin'))
  );
create policy "Admins can delete buildings" on public.buildings
  for delete using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'super_admin'))
  );
-- Keep select open for all authenticated users
create policy "Authenticated can view buildings" on public.buildings
  for select using (auth.role() = 'authenticated');

-- FLATS: same treatment
drop policy if exists "Authenticated users can manage flats" on public.flats;

create policy "Authenticated can view flats" on public.flats
  for select using (auth.role() = 'authenticated');
create policy "Admins can write flats" on public.flats
  for insert with check (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'super_admin'))
  );
create policy "Admins can update flats" on public.flats
  for update using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'super_admin'))
  );
create policy "Admins can delete flats" on public.flats
  for delete using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'super_admin'))
  );

-- TENANTS: all roles can insert/update (check-in, rent collection), only admins can delete
drop policy if exists "Authenticated users can manage tenants" on public.tenants;

create policy "Authenticated can view tenants" on public.tenants
  for select using (auth.role() = 'authenticated');
create policy "Authenticated can insert tenants" on public.tenants
  for insert with check (auth.role() = 'authenticated');
create policy "Authenticated can update tenants" on public.tenants
  for update using (auth.role() = 'authenticated');
create policy "Admins can delete tenants" on public.tenants
  for delete using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'super_admin'))
  );

-- RENT_COLLECTIONS: all roles can insert/update, only admins can delete financial records
drop policy if exists "Authenticated users can manage rent collections" on public.rent_collections;

create policy "Authenticated can view rent_collections" on public.rent_collections
  for select using (auth.role() = 'authenticated');
create policy "Authenticated can insert rent_collections" on public.rent_collections
  for insert with check (auth.role() = 'authenticated');
create policy "Authenticated can update rent_collections" on public.rent_collections
  for update using (auth.role() = 'authenticated');
create policy "Admins can delete rent_collections" on public.rent_collections
  for delete using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'super_admin'))
  );

-- ============================================================
-- 5. audit_log — immutable append-only log of financial changes
-- ============================================================
create table if not exists public.audit_log (
  id          uuid primary key default uuid_generate_v4(),
  table_name  text not null,
  record_id   uuid not null,
  action      text not null check (action in ('insert', 'update', 'delete')),
  old_data    jsonb,
  new_data    jsonb,
  changed_by  uuid references public.profiles(id),
  changed_at  timestamptz not null default now()
);

alter table public.audit_log enable row level security;

create policy "Super admins can view audit_log" on public.audit_log
  for select using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  );

-- No update or delete policies — audit_log is append-only by design
create policy "Authenticated can insert audit_log" on public.audit_log
  for insert with check (auth.role() = 'authenticated');

create index if not exists idx_audit_log_table on public.audit_log(table_name);
create index if not exists idx_audit_log_record on public.audit_log(record_id);
create index if not exists idx_audit_log_changed_at on public.audit_log(changed_at desc);

-- ============================================================
-- 6. audit_notes — team explanations for flagged/unpaid items
--    (referenced in Audit.jsx but missing from schema)
-- ============================================================
create table if not exists public.audit_notes (
  id              uuid primary key default uuid_generate_v4(),
  month           text not null,           -- 'YYYY-MM'
  note_type       text not null check (note_type in ('unpaid', 'partial', 'bank_mismatch', 'fraud', 'other')),
  tenant_id       uuid references public.tenants(id) on delete set null,
  flag_reason     text not null,
  bank_narration  text,
  bank_amount     numeric(10,2),
  team_note       text,
  status          text not null default 'open' check (status in ('open', 'explained', 'escalated', 'resolved')),
  created_by      uuid references public.profiles(id),
  responded_by    uuid references public.profiles(id),
  responded_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.audit_notes enable row level security;

create policy "Super admins can manage audit_notes" on public.audit_notes
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  );
create policy "Admins can view and respond to audit_notes" on public.audit_notes
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'super_admin'))
  );

create index if not exists idx_audit_notes_month on public.audit_notes(month);
create index if not exists idx_audit_notes_tenant on public.audit_notes(tenant_id);
create index if not exists idx_audit_notes_status on public.audit_notes(status);

create trigger update_audit_notes_updated_at
  before update on public.audit_notes
  for each row execute function update_updated_at();

-- ============================================================
-- 7. audit_sessions — saved audit run snapshots
--    (referenced in Audit.jsx but missing from schema)
-- ============================================================
create table if not exists public.audit_sessions (
  id                   uuid primary key default uuid_generate_v4(),
  month                text not null,      -- 'YYYY-MM'
  stats                jsonb,
  tenant_status        jsonb,
  fraud_flags          jsonb,
  unmatched_bank       jsonb,
  building_summary     jsonb,
  collector_stats      jsonb,
  day_wise             jsonb,
  created_by           uuid references public.profiles(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

alter table public.audit_sessions enable row level security;

create policy "Super admins can manage audit_sessions" on public.audit_sessions
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  );

create index if not exists idx_audit_sessions_month on public.audit_sessions(month);

create trigger update_audit_sessions_updated_at
  before update on public.audit_sessions
  for each row execute function update_updated_at();

-- ============================================================
-- 8. Performance indexes missing from original schema
-- ============================================================
create index if not exists idx_flats_status on public.flats(status);
create index if not exists idx_flats_current_tenant on public.flats(current_tenant_id);
create index if not exists idx_tenants_status on public.tenants(status);
create index if not exists idx_staff_salaries_month on public.staff_salaries(for_month);
create index if not exists idx_staff_salaries_staff on public.staff_salaries(staff_id);
create index if not exists idx_rent_collections_flat on public.rent_collections(flat_id);

-- ============================================================
-- 9. Grant is_platform_admin only to the designated account
--    EDIT the email below before running
-- ============================================================
-- update public.profiles
--   set is_platform_admin = true
-- where email = 'your-platform-admin@email.com';
