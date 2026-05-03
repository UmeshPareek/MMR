-- ============================================================
-- MMR – Manage My Rent | Supabase Schema
-- Rent N Stay Property Management System
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- PROFILES (linked to auth.users)
-- ============================================================
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  full_name text not null,
  email text not null,
  phone text,
  role text not null check (role in ('super_admin', 'admin', 'team')) default 'team',
  is_active boolean default true,
  avatar_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "Users can view all profiles" on public.profiles for select using (true);
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);
create policy "Admins can manage profiles" on public.profiles for all using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('super_admin', 'admin'))
);

-- ============================================================
-- OWNERS (building owners Rent N Stay takes flats from)
-- ============================================================
create table public.owners (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  phone text,
  email text,
  address text,
  bank_name text,
  bank_account text,
  bank_ifsc text,
  notes text,
  is_active boolean default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.owners enable row level security;
create policy "Authenticated users can view owners" on public.owners for select using (auth.role() = 'authenticated');
create policy "Admins can manage owners" on public.owners for all using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('super_admin', 'admin'))
);
create policy "Team can insert owners" on public.owners for insert with check (auth.role() = 'authenticated');
create policy "Team can update owners" on public.owners for update using (auth.role() = 'authenticated');

-- ============================================================
-- BUILDINGS
-- ============================================================
create table public.buildings (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  address text not null,
  area text,
  city text default 'Bangalore',
  owner_id uuid references public.owners(id),
  total_flats integer default 0,
  security_deposit_cash numeric(12,2) default 0,
  security_deposit_bank numeric(12,2) default 0,
  monthly_rent_to_owner numeric(12,2) default 0,
  lease_start_date date,
  lease_end_date date,
  notes text,
  is_active boolean default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.buildings enable row level security;
create policy "Authenticated users can view buildings" on public.buildings for select using (auth.role() = 'authenticated');
create policy "Authenticated users can manage buildings" on public.buildings for all using (auth.role() = 'authenticated');

-- ============================================================
-- FLATS
-- ============================================================
create table public.flats (
  id uuid primary key default uuid_generate_v4(),
  building_id uuid references public.buildings(id) on delete cascade,
  door_number text not null,
  floor_number integer,
  flat_type text, -- '1BHK', '2BHK', etc.
  area_sqft numeric(8,2),
  monthly_rent numeric(10,2) not null default 0,
  security_deposit_months integer default 2,
  status text default 'vacant' check (status in ('occupied', 'vacant', 'maintenance')),
  current_tenant_id uuid, -- will be set via FK after tenants table
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.flats enable row level security;
create policy "Authenticated users can manage flats" on public.flats for all using (auth.role() = 'authenticated');

-- ============================================================
-- TENANTS (sub-lessees)
-- ============================================================
create table public.tenants (
  id uuid primary key default uuid_generate_v4(),
  full_name text not null,
  phone text not null,
  email text,
  id_type text, -- Aadhaar, PAN, Passport
  id_number text,
  flat_id uuid references public.flats(id),
  building_id uuid references public.buildings(id),
  move_in_date date,
  move_out_date date,
  monthly_rent numeric(10,2) not null,
  security_deposit_paid numeric(10,2) default 0,
  security_deposit_months integer default 2,
  emergency_contact text,
  emergency_phone text,
  status text default 'active' check (status in ('active', 'vacated', 'notice')),
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.tenants enable row level security;
create policy "Authenticated users can manage tenants" on public.tenants for all using (auth.role() = 'authenticated');

-- Add FK from flats to tenants
alter table public.flats add constraint flats_current_tenant_fk
  foreign key (current_tenant_id) references public.tenants(id) on delete set null;

-- ============================================================
-- RENT COLLECTIONS (from tenants)
-- ============================================================
create table public.rent_collections (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid references public.tenants(id) not null,
  flat_id uuid references public.flats(id) not null,
  building_id uuid references public.buildings(id) not null,
  amount numeric(10,2) not null,
  payment_mode text not null check (payment_mode in ('cash', 'upi', 'bank_transfer', 'rentok', 'crib', 'cheque', 'other')),
  payment_date date not null default current_date,
  for_month text not null, -- 'YYYY-MM'
  transaction_ref text,
  collected_by uuid references public.profiles(id),
  status text default 'received' check (status in ('received', 'pending', 'partial')),
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.rent_collections enable row level security;
create policy "Authenticated users can manage rent collections" on public.rent_collections for all using (auth.role() = 'authenticated');

-- ============================================================
-- UTILITY CHARGES TO TENANTS (water + electricity billed to tenants)
-- ============================================================
create table public.utility_charges (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid references public.tenants(id),
  flat_id uuid references public.flats(id),
  building_id uuid references public.buildings(id) not null,
  utility_type text not null check (utility_type in ('water', 'electricity', 'both')),
  amount numeric(10,2) not null,
  payment_mode text check (payment_mode in ('cash', 'upi', 'bank_transfer', 'other')),
  charge_date date not null default current_date,
  for_month text not null, -- 'YYYY-MM'
  transaction_ref text,
  collected_by uuid references public.profiles(id),
  status text default 'paid' check (status in ('paid', 'pending')),
  notes text,
  created_at timestamptz default now()
);

alter table public.utility_charges enable row level security;
create policy "Authenticated users can manage utility charges" on public.utility_charges for all using (auth.role() = 'authenticated');

-- ============================================================
-- SECURITY DEPOSITS FROM TENANTS
-- ============================================================
create table public.security_deposits (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid references public.tenants(id) not null,
  flat_id uuid references public.flats(id),
  building_id uuid references public.buildings(id) not null,
  amount numeric(10,2) not null,
  payment_mode text check (payment_mode in ('cash', 'upi', 'bank_transfer', 'other')),
  deposit_date date not null default current_date,
  deposit_type text default 'collection' check (deposit_type in ('collection', 'refund')),
  transaction_ref text,
  collected_by uuid references public.profiles(id),
  notes text,
  created_at timestamptz default now()
);

alter table public.security_deposits enable row level security;
create policy "Authenticated users can manage security deposits" on public.security_deposits for all using (auth.role() = 'authenticated');

-- ============================================================
-- OWNER PAYMENTS (rent + security paid TO building owners)
-- ============================================================
create table public.owner_payments (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid references public.owners(id) not null,
  building_id uuid references public.buildings(id) not null,
  payment_type text not null check (payment_type in ('rent', 'security_deposit', 'advance', 'other')),
  payment_mode text not null check (payment_mode in ('cash', 'upi', 'bank_transfer', 'cheque', 'other')),
  amount numeric(10,2) not null,
  payment_date date not null default current_date,
  for_month text, -- 'YYYY-MM' for monthly rent
  transaction_ref text,
  paid_by uuid references public.profiles(id),
  notes text,
  created_at timestamptz default now()
);

alter table public.owner_payments enable row level security;
create policy "Authenticated users can manage owner payments" on public.owner_payments for all using (auth.role() = 'authenticated');

-- ============================================================
-- UTILITY BILLS (paid TO government/vendors)
-- ============================================================
create table public.utility_bills (
  id uuid primary key default uuid_generate_v4(),
  building_id uuid references public.buildings(id) not null,
  utility_type text not null check (utility_type in ('water', 'electricity', 'both')),
  vendor text,
  bill_number text,
  amount numeric(10,2) not null,
  payment_mode text check (payment_mode in ('cash', 'upi', 'bank_transfer', 'online', 'other')),
  bill_date date,
  payment_date date not null default current_date,
  for_month text, -- 'YYYY-MM'
  transaction_ref text,
  paid_by uuid references public.profiles(id),
  notes text,
  created_at timestamptz default now()
);

alter table public.utility_bills enable row level security;
create policy "Authenticated users can manage utility bills" on public.utility_bills for all using (auth.role() = 'authenticated');

-- ============================================================
-- EXPENSES (marketing, wifi, misc, etc.)
-- ============================================================
create table public.expenses (
  id uuid primary key default uuid_generate_v4(),
  category text not null check (category in ('marketing', 'wifi', 'maintenance', 'cleaning', 'transport', 'office', 'legal', 'misc')),
  description text not null,
  amount numeric(10,2) not null,
  payment_mode text check (payment_mode in ('cash', 'upi', 'bank_transfer', 'card', 'other')),
  expense_date date not null default current_date,
  building_id uuid references public.buildings(id), -- nullable for general expenses
  vendor text,
  transaction_ref text,
  receipt_url text,
  paid_by uuid references public.profiles(id),
  notes text,
  created_at timestamptz default now()
);

alter table public.expenses enable row level security;
create policy "Authenticated users can manage expenses" on public.expenses for all using (auth.role() = 'authenticated');

-- ============================================================
-- STAFF
-- ============================================================
create table public.staff (
  id uuid primary key default uuid_generate_v4(),
  full_name text not null,
  phone text,
  email text,
  role text, -- 'manager', 'caretaker', 'cleaner', etc.
  assigned_building_id uuid references public.buildings(id),
  monthly_salary numeric(10,2) not null default 0,
  join_date date,
  id_type text,
  id_number text,
  bank_name text,
  bank_account text,
  bank_ifsc text,
  status text default 'active' check (status in ('active', 'inactive', 'terminated')),
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.staff enable row level security;
create policy "Authenticated users can manage staff" on public.staff for all using (auth.role() = 'authenticated');

-- ============================================================
-- STAFF SALARIES
-- ============================================================
create table public.staff_salaries (
  id uuid primary key default uuid_generate_v4(),
  staff_id uuid references public.staff(id) not null,
  for_month text not null, -- 'YYYY-MM'
  gross_salary numeric(10,2) not null,
  advance_deduction numeric(10,2) default 0,
  other_deduction numeric(10,2) default 0,
  net_salary numeric(10,2) not null,
  payment_mode text check (payment_mode in ('cash', 'upi', 'bank_transfer', 'other')),
  payment_date date,
  transaction_ref text,
  status text default 'pending' check (status in ('pending', 'paid', 'partial')),
  paid_by uuid references public.profiles(id),
  notes text,
  created_at timestamptz default now()
);

alter table public.staff_salaries enable row level security;
create policy "Authenticated users can manage staff salaries" on public.staff_salaries for all using (auth.role() = 'authenticated');

-- ============================================================
-- STAFF ADVANCES
-- ============================================================
create table public.staff_advances (
  id uuid primary key default uuid_generate_v4(),
  staff_id uuid references public.staff(id) not null,
  amount numeric(10,2) not null,
  payment_mode text check (payment_mode in ('cash', 'upi', 'bank_transfer', 'other')),
  advance_date date not null default current_date,
  reason text,
  deducted boolean default false,
  deducted_in_month text, -- 'YYYY-MM'
  paid_by uuid references public.profiles(id),
  notes text,
  created_at timestamptz default now()
);

alter table public.staff_advances enable row level security;
create policy "Authenticated users can manage staff advances" on public.staff_advances for all using (auth.role() = 'authenticated');

-- ============================================================
-- BANK STATEMENTS (for audit)
-- ============================================================
create table public.bank_statements (
  id uuid primary key default uuid_generate_v4(),
  bank_name text not null,
  account_number text,
  statement_month text not null, -- 'YYYY-MM'
  file_name text,
  file_url text,
  opening_balance numeric(12,2),
  closing_balance numeric(12,2),
  total_credits numeric(12,2),
  total_debits numeric(12,2),
  parsed_transactions jsonb, -- array of transactions from CSV/Excel
  reconciliation_status text default 'pending' check (reconciliation_status in ('pending', 'processing', 'completed', 'flagged')),
  reconciliation_notes text,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.bank_statements enable row level security;
create policy "Only super admins can manage bank statements" on public.bank_statements for all using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
);

-- ============================================================
-- AUDIT FLAGS
-- ============================================================
create table public.audit_flags (
  id uuid primary key default uuid_generate_v4(),
  flag_type text not null check (flag_type in ('unmatched_debit', 'unmatched_credit', 'duplicate', 'large_transaction', 'unusual_pattern', 'missing_entry', 'cash_discrepancy', 'trend_anomaly')),
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  title text not null,
  description text not null,
  amount numeric(12,2),
  transaction_date date,
  related_entity_type text, -- 'building', 'tenant', 'staff', 'bank_statement'
  related_entity_id uuid,
  bank_statement_id uuid references public.bank_statements(id),
  is_resolved boolean default false,
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  resolution_notes text,
  created_at timestamptz default now()
);

alter table public.audit_flags enable row level security;
create policy "Only super admins can manage audit flags" on public.audit_flags for all using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
);

-- ============================================================
-- TRIGGERS: auto-update updated_at
-- ============================================================
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger update_buildings_updated_at before update on public.buildings for each row execute function update_updated_at();
create trigger update_flats_updated_at before update on public.flats for each row execute function update_updated_at();
create trigger update_tenants_updated_at before update on public.tenants for each row execute function update_updated_at();
create trigger update_owners_updated_at before update on public.owners for each row execute function update_updated_at();
create trigger update_staff_updated_at before update on public.staff for each row execute function update_updated_at();
create trigger update_profiles_updated_at before update on public.profiles for each row execute function update_updated_at();

-- ============================================================
-- TRIGGER: auto-create profile on signup
-- ============================================================
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'team')
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- VIEWS for reporting
-- ============================================================

-- Monthly cash flow summary view
create or replace view public.monthly_cash_flow as
select
  date_trunc('month', payment_date)::date as month,
  'rent_collection' as type,
  sum(amount) as amount,
  building_id
from public.rent_collections
group by 1, 2, 4

union all

select
  date_trunc('month', charge_date)::date as month,
  'utility_charge' as type,
  sum(amount) as amount,
  building_id
from public.utility_charges
group by 1, 2, 4

union all

select
  date_trunc('month', payment_date)::date as month,
  'owner_payment' as type,
  -sum(amount) as amount,
  building_id
from public.owner_payments
group by 1, 2, 4

union all

select
  date_trunc('month', payment_date)::date as month,
  'utility_bill' as type,
  -sum(amount) as amount,
  building_id
from public.utility_bills
group by 1, 2, 4

union all

select
  date_trunc('month', expense_date)::date as month,
  'expense' as type,
  -sum(amount) as amount,
  building_id
from public.expenses
group by 1, 2, 4;

-- ============================================================
-- INDEXES for performance
-- ============================================================
create index idx_rent_collections_building on public.rent_collections(building_id);
create index idx_rent_collections_tenant on public.rent_collections(tenant_id);
create index idx_rent_collections_month on public.rent_collections(for_month);
create index idx_rent_collections_date on public.rent_collections(payment_date);
create index idx_tenants_building on public.tenants(building_id);
create index idx_tenants_flat on public.tenants(flat_id);
create index idx_flats_building on public.flats(building_id);
create index idx_expenses_date on public.expenses(expense_date);
create index idx_expenses_category on public.expenses(category);
create index idx_owner_payments_date on public.owner_payments(payment_date);
create index idx_audit_flags_severity on public.audit_flags(severity);
create index idx_audit_flags_resolved on public.audit_flags(is_resolved);
