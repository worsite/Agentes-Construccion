-- =====================================================================
-- Gastos y pagos: esquema completo para Supabase (Postgres + RLS)
-- Ejecutar UNA vez en: Supabase > SQL Editor > New query > Run.
-- Es idempotente en lo posible (create if not exists / or replace).
-- =====================================================================

-- ---------- Perfiles ----------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      text not null,
  display_name  text not null,
  status        text not null default 'pending' check (status in ('pending','approved','rejected')),
  is_admin      boolean not null default false,
  monthly_quota numeric(14,2) not null default 0 check (monthly_quota >= 0),
  created_at    timestamptz not null default now(),
  constraint username_formato check (username ~ '^[a-z0-9_]{3,20}$')
);
create unique index if not exists profiles_username_uq on public.profiles (lower(username));

-- ---------- Gastos generales (gas, agua, etc.) ----------
create table if not exists public.general_expenses (
  id         uuid primary key default gen_random_uuid(),
  month      date not null check (month = date_trunc('month', month)::date),
  name       text not null check (char_length(name) between 1 and 80),
  amount     numeric(14,2) not null check (amount >= 0),
  paid       boolean not null default false,
  paid_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists general_expenses_month_idx on public.general_expenses (month);

-- ---------- Pagos de cada usuario (aportes a la meta mensual) ----------
create table if not exists public.payments (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  amount     numeric(14,2) not null check (amount > 0),
  method     text not null check (method in ('efectivo','transferencia')),
  paid_on    date not null default current_date,
  created_at timestamptz not null default now()
);
create index if not exists payments_user_date_idx on public.payments (user_id, paid_on);

-- ---------- Ahorros (privados) ----------
create table if not exists public.savings_accounts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 80),
  goal       numeric(14,2) check (goal is null or goal > 0),
  created_at timestamptz not null default now(),
  unique (id, user_id)
);
create table if not exists public.savings_entries (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  user_id    uuid not null,
  amount     numeric(14,2) not null check (amount > 0),
  method     text not null check (method in ('efectivo','transferencia')),
  entry_on   date not null default current_date,
  created_at timestamptz not null default now(),
  foreign key (account_id, user_id) references public.savings_accounts (id, user_id) on delete cascade
);
create index if not exists savings_entries_acc_idx on public.savings_entries (account_id);

-- ---------- Deudas (privadas) ----------
create table if not exists public.debts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 80),
  target_date date,                       -- fecha en que quiere terminar de pagarla
  daily_plan  numeric(14,2) not null default 0 check (daily_plan >= 0), -- cuanto quiere pagar por dia (0 = no incluida)
  created_at  timestamptz not null default now(),
  unique (id, user_id)
);
-- Cada registro del monto con su fecha (el monto puede cambiar por intereses).
-- Para bases ya creadas con la version anterior:
alter table public.debts add column if not exists daily_plan numeric(14,2) not null default 0 check (daily_plan >= 0);
create table if not exists public.debt_balances (
  id          uuid primary key default gen_random_uuid(),
  debt_id     uuid not null,
  user_id     uuid not null,
  amount      numeric(14,2) not null check (amount >= 0),
  recorded_on date not null default current_date,
  created_at  timestamptz not null default now(),
  foreign key (debt_id, user_id) references public.debts (id, user_id) on delete cascade
);
create table if not exists public.debt_payments (
  id         uuid primary key default gen_random_uuid(),
  debt_id    uuid not null,
  user_id    uuid not null,
  amount     numeric(14,2) not null check (amount > 0),
  paid_on    date not null default current_date,
  created_at timestamptz not null default now(),
  foreign key (debt_id, user_id) references public.debts (id, user_id) on delete cascade
);
create index if not exists debt_balances_debt_idx on public.debt_balances (debt_id, recorded_on);
create index if not exists debt_payments_debt_idx on public.debt_payments (debt_id, paid_on);

-- ---------- Funciones auxiliares ----------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin and status = 'approved' from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.is_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select status = 'approved' from public.profiles where id = auth.uid()), false);
$$;

-- Al registrarse en Auth se crea el perfil en estado 'pending'.
-- NUNCA se concede is_admin desde aqui ni desde datos del cliente.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_username text := lower(coalesce(new.raw_user_meta_data->>'username',''));
  v_display  text := btrim(coalesce(new.raw_user_meta_data->>'display_name',''));
begin
  if v_username !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'Nombre de usuario invalido (3-20 caracteres: letras minusculas, numeros y _)';
  end if;
  if char_length(v_display) not between 1 and 60 then
    raise exception 'Nombre invalido';
  end if;
  insert into public.profiles (id, username, display_name) values (new.id, v_username, v_display);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Los pagos y gastos pagados guardan paid_at automaticamente.
create or replace function public.set_paid_at() returns trigger
language plpgsql as $$
begin
  if new.paid and (tg_op = 'INSERT' or not old.paid) then new.paid_at := now();
  elsif not new.paid then new.paid_at := null; end if;
  return new;
end $$;
drop trigger if exists general_expenses_paid_at on public.general_expenses;
create trigger general_expenses_paid_at before insert or update on public.general_expenses
  for each row execute function public.set_paid_at();

-- ---------- Panel general publico (visible sin iniciar sesion) ----------
-- La cuota de cada usuario = (suma de gastos generales del mes) / (usuarios aprobados), redondeada hacia arriba.
-- Solo expone nombre, cuota y total pagado del mes. Nada de metodo, ahorros ni deudas.
create or replace function public.panel_usuarios(p_month date default date_trunc('month', current_date)::date)
returns table (username text, display_name text, quota numeric, paid numeric)
language sql stable security definer set search_path = public as $$
  with tot as (
    select coalesce(sum(amount), 0) as t from public.general_expenses
    where month = date_trunc('month', p_month)::date
  ), n as (
    select count(*) as c from public.profiles where status = 'approved'
  )
  select p.username, p.display_name,
         case when n.c > 0 then ceil(tot.t / n.c) else 0 end,
         coalesce((select sum(py.amount) from public.payments py
                   where py.user_id = p.id
                     and py.paid_on >= date_trunc('month', p_month)::date
                     and py.paid_on <  (date_trunc('month', p_month) + interval '1 month')::date), 0)
  from public.profiles p, tot, n
  where p.status = 'approved'
  order by p.display_name;
$$;

-- ---------- Acciones del administrador ----------
create or replace function public.admin_set_status(p_user uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'No autorizado'; end if;
  if p_status not in ('approved','rejected') then raise exception 'Estado invalido'; end if;
  update public.profiles set status = p_status where id = p_user and is_admin = false;
end $$;

-- La cuota ya no se fija a mano: ver panel_usuarios.
drop function if exists public.admin_set_quota(uuid, numeric);

-- Copia los gastos de un mes a otro (sin marcar como pagados).
create or replace function public.admin_copy_expenses(p_from date, p_to date) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.is_admin() then raise exception 'No autorizado'; end if;
  insert into public.general_expenses (month, name, amount)
    select date_trunc('month', p_to)::date, name, amount
    from public.general_expenses where month = date_trunc('month', p_from)::date;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- Row Level Security ----------
alter table public.profiles          enable row level security;
alter table public.general_expenses  enable row level security;
alter table public.payments          enable row level security;
alter table public.savings_accounts  enable row level security;
alter table public.savings_entries   enable row level security;
alter table public.debts             enable row level security;
alter table public.debt_balances     enable row level security;
alter table public.debt_payments     enable row level security;

-- profiles: cada quien ve el suyo; el admin ve todos (para aprobar). Nadie edita directo.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());

-- general_expenses: lectura publica, escritura solo admin.
drop policy if exists ge_select on public.general_expenses;
create policy ge_select on public.general_expenses for select to anon, authenticated using (true);
drop policy if exists ge_admin_ins on public.general_expenses;
create policy ge_admin_ins on public.general_expenses for insert to authenticated with check (public.is_admin());
drop policy if exists ge_admin_upd on public.general_expenses;
create policy ge_admin_upd on public.general_expenses for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists ge_admin_del on public.general_expenses;
create policy ge_admin_del on public.general_expenses for delete to authenticated using (public.is_admin());

-- payments: solo el dueno (aprobado). El admin NO ve pagos ajenos individualmente.
drop policy if exists pay_select on public.payments;
create policy pay_select on public.payments for select to authenticated using (user_id = auth.uid());
drop policy if exists pay_insert on public.payments;
create policy pay_insert on public.payments for insert to authenticated with check (user_id = auth.uid() and public.is_approved());
drop policy if exists pay_delete on public.payments;
create policy pay_delete on public.payments for delete to authenticated using (user_id = auth.uid());

-- ahorros y deudas: estrictamente privados (ni el admin los ve).
do $$
declare t text;
begin
  foreach t in array array['savings_accounts','savings_entries','debts','debt_balances','debt_payments'] loop
    execute format('drop policy if exists %I_sel on public.%I', t, t);
    execute format('create policy %I_sel on public.%I for select to authenticated using (user_id = auth.uid())', t, t);
    execute format('drop policy if exists %I_ins on public.%I', t, t);
    execute format('create policy %I_ins on public.%I for insert to authenticated with check (user_id = auth.uid() and public.is_approved())', t, t);
    execute format('drop policy if exists %I_del on public.%I', t, t);
    execute format('create policy %I_del on public.%I for delete to authenticated using (user_id = auth.uid())', t, t);
  end loop;
end $$;
-- Las deudas permiten cambiar la fecha objetivo.
drop policy if exists debts_upd on public.debts;
create policy debts_upd on public.debts for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Permisos ----------
revoke all on all tables in schema public from anon, authenticated;
grant select on public.general_expenses to anon, authenticated;
grant insert, update, delete on public.general_expenses to authenticated;
grant select on public.profiles to authenticated;
grant select, insert, delete on public.payments, public.savings_accounts, public.savings_entries,
      public.debts, public.debt_balances, public.debt_payments to authenticated;
grant update (target_date, daily_plan) on public.debts to authenticated;

revoke all on function public.panel_usuarios(date) from public;
grant execute on function public.panel_usuarios(date) to anon, authenticated;
revoke all on function public.admin_set_status(uuid,text), public.admin_copy_expenses(date,date) from public;
grant execute on function public.admin_set_status(uuid,text), public.admin_copy_expenses(date,date) to authenticated;
grant execute on function public.is_admin(), public.is_approved() to authenticated;

-- =====================================================================
-- PASO MANUAL (despues de registrarte tu mismo como "miguel" en la app):
--   update public.profiles set is_admin = true, status = 'approved'
--   where username = 'miguel';
-- Ver README.md.
-- =====================================================================
