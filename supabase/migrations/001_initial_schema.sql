-- ÉLAN Studio initial schema. Review and apply in Supabase SQL Editor.
create extension if not exists pgcrypto;
create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 full_name text,
 phone text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.user_roles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 role text not null check (role in ('admin','staff')),
 created_at timestamptz not null default now()
);
create table if not exists public.categories (
 id uuid primary key default gen_random_uuid(), name text not null, slug text unique not null,
 description text, is_active boolean not null default true, created_at timestamptz not null default now()
);
create table if not exists public.services (
 id uuid primary key default gen_random_uuid(), category_id uuid references public.categories(id) on delete set null,
 name text not null, slug text unique, short_description text, description text,
 price numeric(10,2) not null check(price >= 0), duration_minutes integer not null check(duration_minutes > 0),
 image_url text, is_active boolean not null default true, created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.specialists (
 id uuid primary key default gen_random_uuid(), full_name text not null, position text, bio text, photo_url text,
 experience_years integer check(experience_years >= 0), is_active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.specialist_services (
 id uuid primary key default gen_random_uuid(), specialist_id uuid not null references public.specialists(id) on delete cascade,
 service_id uuid not null references public.services(id) on delete cascade, unique(specialist_id,service_id)
);
create table if not exists public.working_hours (
 id uuid primary key default gen_random_uuid(), specialist_id uuid not null references public.specialists(id) on delete cascade,
 day_of_week smallint not null check(day_of_week between 0 and 6), start_time time, end_time time,
 is_day_off boolean not null default false, check(is_day_off or (start_time is not null and end_time > start_time))
);
create table if not exists public.breaks (
 id uuid primary key default gen_random_uuid(), specialist_id uuid not null references public.specialists(id) on delete cascade,
 start_at timestamptz not null, end_at timestamptz not null, description text, check(end_at > start_at)
);
create table if not exists public.appointments (
 id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete set null,
 service_id uuid not null references public.services(id), specialist_id uuid not null references public.specialists(id),
 client_name text not null, client_phone text not null, client_email text, start_at timestamptz not null, end_at timestamptz not null,
 status text not null default 'pending' check(status in ('pending','confirmed','completed','cancelled','no_show')),
 comment text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(end_at > start_at)
);
create index if not exists appointments_specialist_time_idx on public.appointments(specialist_id,start_at,end_at);
create index if not exists appointments_user_idx on public.appointments(user_id);
create table if not exists public.reviews (
 id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete set null,
 author_name text not null, rating integer not null check(rating between 1 and 5), content text not null,
 is_published boolean not null default false, created_at timestamptz not null default now()
);
create table if not exists public.promotions (
 id uuid primary key default gen_random_uuid(), title text not null, description text, image_url text,
 discount_percent integer check(discount_percent between 0 and 100), starts_at timestamptz, ends_at timestamptz,
 is_active boolean not null default true, created_at timestamptz not null default now(), check(ends_at is null or starts_at is null or ends_at > starts_at)
);
create table if not exists public.contact_messages (
 id uuid primary key default gen_random_uuid(), name text not null, email text not null, phone text, message text not null,
 status text not null default 'new' check(status in ('new','in_progress','closed')), created_at timestamptz not null default now()
);
create table if not exists public.site_settings (
 id uuid primary key default gen_random_uuid(), setting_key text unique not null, setting_value jsonb not null default '{}'::jsonb,
 updated_at timestamptz not null default now()
);
-- RLS enabled on all tables exposed through the API.
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.categories enable row level security;
alter table public.services enable row level security;
alter table public.specialists enable row level security;
alter table public.specialist_services enable row level security;
alter table public.working_hours enable row level security;
alter table public.breaks enable row level security;
alter table public.appointments enable row level security;
alter table public.reviews enable row level security;
alter table public.promotions enable row level security;
alter table public.contact_messages enable row level security;
alter table public.site_settings enable row level security;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.user_roles where user_id=auth.uid() and role='admin'); $$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;
create policy "public read active categories" on public.categories for select to anon,authenticated using(is_active or public.is_admin());
create policy "public read active services" on public.services for select to anon,authenticated using(is_active or public.is_admin());
create policy "public read active specialists" on public.specialists for select to anon,authenticated using(is_active or public.is_admin());
create policy "public read published reviews" on public.reviews for select to anon,authenticated using(is_published or user_id=auth.uid() or public.is_admin());
create policy "public read active promotions" on public.promotions for select to anon,authenticated using(is_active or public.is_admin());
create policy "profile read own" on public.profiles for select to authenticated using(id=auth.uid() or public.is_admin());
create policy "profile update own" on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
create policy "appointments read own or admin" on public.appointments for select to authenticated using(user_id=auth.uid() or public.is_admin());
create policy "admin manage categories" on public.categories for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "admin manage services" on public.services for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "admin manage specialists" on public.specialists for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "admin manage specialist services" on public.specialist_services for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "admin manage working hours" on public.working_hours for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "admin manage breaks" on public.breaks for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "admin manage appointments" on public.appointments for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "admin manage reviews" on public.reviews for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "admin manage promotions" on public.promotions for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "admin read messages" on public.contact_messages for select to authenticated using(public.is_admin());
create policy "admin update messages" on public.contact_messages for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "public read settings" on public.site_settings for select to anon,authenticated using(true);
create policy "admin manage settings" on public.site_settings for all to authenticated using(public.is_admin()) with check(public.is_admin());
-- Contact-message inserts should be rate-limited in production; enable this policy only if direct public inserts are acceptable.
create policy "public submit contact messages" on public.contact_messages for insert to anon,authenticated with check(length(name) between 2 and 100 and length(message) between 10 and 4000);
-- Deliberately no public insert policy on appointments. Deploy the Edge Function before accepting real bookings.
insert into public.categories(name,slug,description) values
('Косметология','cosmetology','Процедуры ухода за лицом'),('Массаж','massage','Расслабляющие и классические массажные процедуры'),('SPA','spa','Ритуалы отдыха и восстановления')
on conflict(slug) do nothing;
