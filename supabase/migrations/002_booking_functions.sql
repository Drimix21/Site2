-- Secure booking workflow. Apply after 001_initial_schema.sql.
-- Working hours are interpreted in Europe/Berlin local time; change this timezone if needed.
create extension if not exists btree_gist;
alter table public.appointments add column if not exists consent_at timestamptz;

-- Prevent overlapping non-cancelled appointments for one specialist, including concurrent requests.
do $$ begin
  alter table public.appointments add constraint appointments_no_overlap
  exclude using gist (specialist_id with =, tstzrange(start_at, end_at, '[)') with &&)
  where (status <> 'cancelled');
exception when duplicate_object then null;
end $$;

create or replace function public.get_available_slots(
  p_service_id uuid,
  p_specialist_id uuid default null,
  p_date date default current_date
) returns table(start_at timestamptz, specialist_id uuid, specialist_name text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_service public.services%rowtype;
  v_specialist record;
  v_hours record;
  v_local_start timestamp;
  v_local_end timestamp;
  v_candidate timestamp;
  v_start timestamptz;
  v_end timestamptz;
begin
  if p_date is null or p_date < (now() at time zone 'Europe/Berlin')::date or p_date > (now() at time zone 'Europe/Berlin')::date + 120 then
    return;
  end if;
  select * into v_service from public.services where id=p_service_id and is_active=true;
  if not found then return; end if;
  for v_specialist in
    select s.id, s.full_name from public.specialists s
    join public.specialist_services ss on ss.specialist_id=s.id
    where s.is_active=true and ss.service_id=p_service_id
      and (p_specialist_id is null or s.id=p_specialist_id)
    order by s.full_name
  loop
    for v_hours in
      select wh.start_time, wh.end_time from public.working_hours wh
      where wh.specialist_id=v_specialist.id
        and wh.day_of_week=extract(dow from p_date)::int and not wh.is_day_off
      order by wh.start_time
    loop
      v_local_start := p_date + v_hours.start_time;
      v_local_end := p_date + v_hours.end_time;
      v_candidate := v_local_start;
      while v_candidate + make_interval(mins => v_service.duration_minutes) <= v_local_end loop
        v_start := v_candidate at time zone 'Europe/Berlin';
        v_end := (v_candidate + make_interval(mins => v_service.duration_minutes)) at time zone 'Europe/Berlin';
        if v_start > now()
          and not exists (select 1 from public.appointments a where a.specialist_id=v_specialist.id and a.status <> 'cancelled' and tstzrange(a.start_at,a.end_at,'[)') && tstzrange(v_start,v_end,'[)'))
          and not exists (select 1 from public.breaks b where b.specialist_id=v_specialist.id and tstzrange(b.start_at,b.end_at,'[)') && tstzrange(v_start,v_end,'[)'))
        then
          start_at := v_start; specialist_id := v_specialist.id; specialist_name := v_specialist.full_name; return next;
        end if;
        v_candidate := v_candidate + interval '30 minutes';
      end loop;
    end loop;
  end loop;
end $$;

create or replace function public.create_appointment(
  p_service_id uuid,
  p_specialist_id uuid,
  p_start_at timestamptz,
  p_client_name text,
  p_client_phone text,
  p_client_email text default null,
  p_comment text default null,
  p_consent boolean default false
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_service public.services%rowtype;
  v_specialist record;
  v_end_at timestamptz;
  v_id uuid;
  v_local_start timestamp;
  v_local_end timestamp;
  v_day smallint;
  v_is_available boolean;
begin
  if p_consent is not true then raise exception 'Consent is required'; end if;
  if length(trim(coalesce(p_client_name,''))) not between 2 and 100 then raise exception 'Invalid client name'; end if;
  if length(regexp_replace(coalesce(p_client_phone,''),'[^0-9+]','','g')) not between 7 and 25 then raise exception 'Invalid phone'; end if;
  if p_client_email is not null and length(p_client_email)>254 then raise exception 'Invalid email'; end if;
  if length(coalesce(p_comment,''))>1000 then raise exception 'Comment too long'; end if;
  if p_start_at is null or p_start_at <= now() or p_start_at > now()+interval '120 days' then raise exception 'Invalid appointment time'; end if;
  select * into v_service from public.services where id=p_service_id and is_active=true;
  if not found then raise exception 'Service is unavailable'; end if;
  v_end_at := p_start_at + make_interval(mins => v_service.duration_minutes);
  v_local_start := p_start_at at time zone 'Europe/Berlin';
  v_local_end := v_end_at at time zone 'Europe/Berlin';
  v_day := extract(dow from v_local_start)::smallint;

  for v_specialist in
    select s.id, s.full_name from public.specialists s
    join public.specialist_services ss on ss.specialist_id=s.id and ss.service_id=p_service_id
    where s.is_active=true and (p_specialist_id is null or s.id=p_specialist_id)
    order by case when p_specialist_id is not null then 0 else random() end, s.full_name
  loop
    -- Serializes booking attempts for this specialist and local date.
    perform pg_advisory_xact_lock(hashtext(v_specialist.id::text), hashtext(v_local_start::date::text));
    select exists(
      select 1 from public.working_hours wh
      where wh.specialist_id=v_specialist.id and wh.day_of_week=v_day and not wh.is_day_off
        and v_local_start::time >= wh.start_time and v_local_end::time <= wh.end_time
        and v_local_start::date=v_local_end::date
    ) into v_is_available;
    if not v_is_available then continue; end if;
    if exists(select 1 from public.appointments a where a.specialist_id=v_specialist.id and a.status<>'cancelled' and tstzrange(a.start_at,a.end_at,'[)') && tstzrange(p_start_at,v_end_at,'[)')) then continue; end if;
    if exists(select 1 from public.breaks b where b.specialist_id=v_specialist.id and tstzrange(b.start_at,b.end_at,'[)') && tstzrange(p_start_at,v_end_at,'[)')) then continue; end if;
    insert into public.appointments(user_id,service_id,specialist_id,client_name,client_phone,client_email,start_at,end_at,status,comment,consent_at)
    values(auth.uid(),p_service_id,v_specialist.id,trim(p_client_name),trim(p_client_phone),nullif(trim(coalesce(p_client_email,'')),''),p_start_at,v_end_at,'pending',nullif(trim(coalesce(p_comment,'')),''),now())
    returning id into v_id;
    return v_id;
  end loop;
  raise exception 'Selected time is no longer available';
end $$;

revoke all on function public.get_available_slots(uuid,uuid,date) from public;
grant execute on function public.get_available_slots(uuid,uuid,date) to anon, authenticated;
revoke all on function public.create_appointment(uuid,uuid,timestamptz,text,text,text,text,boolean) from public;
grant execute on function public.create_appointment(uuid,uuid,timestamptz,text,text,text,text,boolean) to anon, authenticated;

-- Protect contact form and private tables; never let users assign themselves roles.
drop policy if exists "public read settings" on public.site_settings;
create policy "public read nonsecret settings" on public.site_settings for select to anon, authenticated using (setting_key in ('contact','hours','socials','booking_rules'));
create policy "admin manage profiles" on public.profiles for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin manage contact messages" on public.contact_messages for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Storage buckets for public marketing images. Upload/delete is restricted to admins.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('service-images','service-images',true,5242880,array['image/jpeg','image/png','image/webp','image/avif']),
       ('specialist-images','specialist-images',true,5242880,array['image/jpeg','image/png','image/webp','image/avif']),
       ('studio-images','studio-images',true,8388608,array['image/jpeg','image/png','image/webp','image/avif'])
on conflict (id) do nothing;
create policy "public view studio images" on storage.objects for select to anon, authenticated using (bucket_id in ('service-images','specialist-images','studio-images'));
create policy "admins upload studio images" on storage.objects for insert to authenticated with check (bucket_id in ('service-images','specialist-images','studio-images') and public.is_admin());
create policy "admins update studio images" on storage.objects for update to authenticated using (bucket_id in ('service-images','specialist-images','studio-images') and public.is_admin()) with check (bucket_id in ('service-images','specialist-images','studio-images') and public.is_admin());
create policy "admins delete studio images" on storage.objects for delete to authenticated using (bucket_id in ('service-images','specialist-images','studio-images') and public.is_admin());

-- Public pages need the mapping between active services and active specialists.
create policy "public read active specialist service mapping" on public.specialist_services
for select to anon, authenticated using (
  exists(select 1 from public.specialists s where s.id=specialist_id and s.is_active=true)
  and exists(select 1 from public.services sv where sv.id=service_id and sv.is_active=true)
);

-- Create/update a profile automatically when an Auth user is created.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id,full_name) values(new.id,coalesce(new.raw_user_meta_data->>'full_name',''))
  on conflict(id) do update set full_name=coalesce(excluded.full_name,public.profiles.full_name),updated_at=now();
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();
