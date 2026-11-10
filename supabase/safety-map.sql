create table if not exists public.trusted_contacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  contact_email text not null,
  contact_user_id uuid references auth.users(id) on delete set null,
  display_name text not null,
  invitation_code uuid not null unique default gen_random_uuid(),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  constraint trusted_contacts_not_self check (contact_user_id is null or contact_user_id <> owner_id)
);

create unique index if not exists trusted_contacts_owner_email_idx
  on public.trusted_contacts (owner_id, lower(contact_email));

create table if not exists public.safety_journeys (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  owner_label text not null,
  origin_latitude double precision not null check (origin_latitude between -90 and 90),
  origin_longitude double precision not null check (origin_longitude between -180 and 180),
  destination_label text not null,
  destination_latitude double precision not null check (destination_latitude between -90 and 90),
  destination_longitude double precision not null check (destination_longitude between -180 and 180),
  distance_meters double precision not null check (distance_meters > 0),
  duration_seconds double precision not null check (duration_seconds > 0),
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

create table if not exists public.location_shares (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid references public.safety_journeys(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid not null references public.trusted_contacts(id) on delete cascade,
  owner_label text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  constraint location_shares_not_self check (recipient_user_id <> owner_id)
);

create index if not exists location_shares_active_owner_idx
  on public.location_shares (owner_id, expires_at) where revoked_at is null;
create index if not exists location_shares_active_recipient_idx
  on public.location_shares (recipient_user_id, expires_at) where revoked_at is null;

create table if not exists public.live_locations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy double precision check (accuracy is null or accuracy between 0 and 100000),
  captured_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.location_update_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_updated_at timestamptz not null
);
alter table public.location_update_limits enable row level security;

create table if not exists public.sos_alerts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  accuracy double precision check (accuracy is null or accuracy between 0 and 100000),
  status text not null default 'active' check (status in ('active', 'cancelled')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes',
  cancelled_at timestamptz,
  constraint sos_alert_coordinates_pair check ((latitude is null) = (longitude is null))
);

create table if not exists public.sos_alert_recipients (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.sos_alerts(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid not null references public.trusted_contacts(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'acknowledged', 'cancelled')),
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  constraint sos_recipients_not_self check (recipient_user_id <> owner_id),
  unique (alert_id, recipient_user_id)
);

alter table public.trusted_contacts enable row level security;
alter table public.safety_journeys enable row level security;
alter table public.location_shares enable row level security;
alter table public.live_locations enable row level security;
alter table public.sos_alerts enable row level security;
alter table public.sos_alert_recipients enable row level security;

drop policy if exists "Contact participants can read relationships" on public.trusted_contacts;
create policy "Contact participants can read relationships" on public.trusted_contacts
  for select to authenticated
  using (owner_id = (select auth.uid()) or contact_user_id = (select auth.uid()));

drop policy if exists "Share participants can read sessions" on public.location_shares;
create policy "Share participants can read sessions" on public.location_shares
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    or (
      recipient_user_id = (select auth.uid())
      and revoked_at is null
      and expires_at > now()
    )
  );

drop policy if exists "Users can read authorized journey details" on public.safety_journeys;
create policy "Users can read authorized journey details" on public.safety_journeys
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    or exists (
      select 1 from public.location_shares s
      where s.journey_id = id
        and s.owner_id = safety_journeys.owner_id
        and s.recipient_user_id = (select auth.uid())
        and s.revoked_at is null
        and s.expires_at > now()
    )
  );

drop policy if exists "Users can create their own journeys" on public.safety_journeys;
create policy "Users can create their own journeys" on public.safety_journeys
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists "Users can end their own journeys" on public.safety_journeys;
create policy "Users can end their own journeys" on public.safety_journeys
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "Users can read their own or shared latest location" on public.live_locations;
create policy "Users can read their own or shared latest location" on public.live_locations
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.location_shares s
      where s.owner_id = live_locations.user_id
        and s.recipient_user_id = (select auth.uid())
        and s.revoked_at is null
        and s.expires_at > now()
    )
  );

drop policy if exists "Users can publish their latest location during sharing" on public.live_locations;
drop policy if exists "Users can update their latest shared location" on public.live_locations;
drop policy if exists "Users can clear their own latest location" on public.live_locations;

create or replace function public.publish_current_location(
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy double precision,
  p_captured_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
begin
  if v_user is null then raise exception 'Sign in before sharing your location.'; end if;
  if p_latitude is null or p_latitude not between -90 and 90
    or p_longitude is null or p_longitude not between -180 and 180
    or (p_accuracy is not null and p_accuracy not between 0 and 100000)
    or p_captured_at is null
    or p_captured_at < v_now - interval '5 minutes'
    or p_captured_at > v_now + interval '10 seconds' then
    raise exception 'The latest device location is invalid or too old to share.';
  end if;
  if not exists (
    select 1 from public.location_shares s
    where s.owner_id = v_user and s.revoked_at is null and s.expires_at > v_now
  ) then
    raise exception 'Start an authorized location-sharing journey before publishing coordinates.';
  end if;

  insert into public.location_update_limits (user_id, last_updated_at)
  values (v_user, v_now - interval '1 minute')
  on conflict (user_id) do nothing;
  update public.location_update_limits
  set last_updated_at = v_now
  where user_id = v_user and last_updated_at <= v_now - interval '2 seconds';
  if not found then raise exception 'Location updates are rate limited. Wait before sending another update.'; end if;

  insert into public.live_locations (user_id, latitude, longitude, accuracy, captured_at, updated_at)
  values (v_user, p_latitude, p_longitude, p_accuracy, p_captured_at, v_now)
  on conflict (user_id) do update
  set latitude = excluded.latitude,
      longitude = excluded.longitude,
      accuracy = excluded.accuracy,
      captured_at = excluded.captured_at,
      updated_at = excluded.updated_at;
end;
$$;

drop policy if exists "SOS participants can read alerts" on public.sos_alerts;
create policy "SOS participants can read alerts" on public.sos_alerts
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    or exists (
      select 1 from public.sos_alert_recipients r
      where r.alert_id = sos_alerts.id
        and r.recipient_user_id = (select auth.uid())
        and sos_alerts.status = 'active'
        and sos_alerts.expires_at > now()
    )
  );

drop policy if exists "SOS participants can read delivery status" on public.sos_alert_recipients;
create policy "SOS participants can read delivery status" on public.sos_alert_recipients
  for select to authenticated
  using (owner_id = (select auth.uid()) or recipient_user_id = (select auth.uid()));

create or replace function public.create_trusted_contact_invite(
  p_contact_email text,
  p_display_name text
)
returns table (contact_id uuid, invitation_code uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_email text := lower(trim(p_contact_email));
  v_id uuid;
begin
  if v_owner is null then raise exception 'Sign in to invite a trusted contact.'; end if;
  if length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid contact email address.';
  end if;
  if v_email = lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'You cannot add your own account as a trusted contact.';
  end if;
  if coalesce(length(trim(p_display_name)), 0) not between 1 and 80 then
    raise exception 'Enter a contact name of 1 to 80 characters.';
  end if;

  select tc.id into v_id
  from public.trusted_contacts tc
  where tc.owner_id = v_owner and lower(tc.contact_email) = v_email;

  if v_id is not null then
    if exists (
      select 1 from public.trusted_contacts tc
      where tc.id = v_id and tc.status = 'accepted'
    ) then
      raise exception 'This account is already in your trusted circle.';
    end if;
    update public.trusted_contacts tc
    set display_name = trim(p_display_name),
        contact_user_id = null,
        invitation_code = gen_random_uuid(),
        status = 'pending',
        created_at = now(),
        expires_at = now() + interval '14 days',
        accepted_at = null
    where tc.id = v_id;
  else
    insert into public.trusted_contacts (owner_id, contact_email, display_name)
    values (v_owner, v_email, trim(p_display_name))
    returning id into v_id;
  end if;

  return query
    select tc.id, tc.invitation_code, tc.expires_at
    from public.trusted_contacts tc where tc.id = v_id;
end;
$$;

create or replace function public.accept_trusted_contact_invite(p_invitation_code uuid)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_owner uuid;
begin
  if v_user is null or v_email = '' then raise exception 'Sign in with the invited email address to accept.'; end if;
  update public.trusted_contacts tc
  set contact_user_id = v_user, status = 'accepted', accepted_at = now()
  where tc.invitation_code = p_invitation_code
    and lower(tc.contact_email) = v_email
    and tc.status = 'pending'
    and tc.expires_at > now()
    and tc.owner_id <> v_user
  returning tc.owner_id into v_owner;
  if v_owner is null then raise exception 'That invitation is invalid, expired, or belongs to a different email address.'; end if;
  return v_owner;
end;
$$;

create or replace function public.revoke_trusted_contact(p_contact_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Sign in to manage trusted contacts.'; end if;
  update public.trusted_contacts tc
  set status = 'revoked'
  where tc.id = p_contact_id
    and (tc.owner_id = v_user or tc.contact_user_id = v_user)
    and tc.status <> 'revoked';
  if not found then raise exception 'Trusted contact relationship not found or already revoked.'; end if;
  update public.location_shares s
  set revoked_at = coalesce(s.revoked_at, now())
  where s.contact_id = p_contact_id and s.revoked_at is null;
end;
$$;

create or replace function public.start_safety_journey(
  p_owner_label text,
  p_origin_latitude double precision,
  p_origin_longitude double precision,
  p_destination_label text,
  p_destination_latitude double precision,
  p_destination_longitude double precision,
  p_distance_meters double precision,
  p_duration_seconds double precision,
  p_contact_ids uuid[],
  p_duration_minutes integer default 60
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_journey uuid;
  v_contact_count integer := coalesce(cardinality(p_contact_ids), 0);
begin
  if v_owner is null then raise exception 'Sign in to save and share a journey.'; end if;
  if length(trim(coalesce(p_owner_label, ''))) not between 1 and 80 then raise exception 'Enter a valid display name.'; end if;
  if length(trim(coalesce(p_destination_label, ''))) not between 1 and 300 then raise exception 'Choose a valid destination.'; end if;
  if p_origin_latitude not between -90 and 90 or p_destination_latitude not between -90 and 90
    or p_origin_longitude not between -180 and 180 or p_destination_longitude not between -180 and 180
    or p_distance_meters <= 0 or p_duration_seconds <= 0 then
    raise exception 'Journey coordinates or route measurements are invalid.';
  end if;
  if p_duration_minutes not between 15 and 120 then raise exception 'Sharing duration must be between 15 and 120 minutes.'; end if;
  if v_contact_count > 10 then raise exception 'Select no more than 10 trusted contacts.'; end if;
  if v_contact_count > 0 and (
    select count(*) from public.trusted_contacts tc
    where tc.id = any(p_contact_ids) and tc.owner_id = v_owner
      and tc.status = 'accepted' and tc.contact_user_id is not null
  ) <> v_contact_count then
    raise exception 'Every selected contact must have accepted your invitation.';
  end if;

  update public.location_shares s
  set revoked_at = coalesce(s.revoked_at, now())
  where s.owner_id = v_owner and s.revoked_at is null;
  update public.safety_journeys j
  set ended_at = coalesce(j.ended_at, now())
  where j.owner_id = v_owner and j.ended_at is null;
  delete from public.live_locations l where l.user_id = v_owner;

  insert into public.safety_journeys (
    owner_id, owner_label, origin_latitude, origin_longitude,
    destination_label, destination_latitude, destination_longitude,
    distance_meters, duration_seconds
  ) values (
    v_owner, trim(p_owner_label), p_origin_latitude, p_origin_longitude,
    trim(p_destination_label), p_destination_latitude, p_destination_longitude,
    p_distance_meters, p_duration_seconds
  ) returning id into v_journey;

  insert into public.location_shares (
    journey_id, owner_id, recipient_user_id, contact_id, owner_label, expires_at
  )
  select v_journey, v_owner, tc.contact_user_id, tc.id, trim(p_owner_label),
    now() + make_interval(mins => p_duration_minutes)
  from public.trusted_contacts tc
  where tc.id = any(coalesce(p_contact_ids, array[]::uuid[]))
    and tc.owner_id = v_owner and tc.status = 'accepted';

  return v_journey;
end;
$$;

create or replace function public.stop_safety_journey(p_journey_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Sign in to end a journey.'; end if;
  update public.safety_journeys j set ended_at = coalesce(j.ended_at, now())
  where j.id = p_journey_id and j.owner_id = v_user and j.ended_at is null;
  if not found then raise exception 'Active journey not found.'; end if;
  update public.location_shares s set revoked_at = coalesce(s.revoked_at, now())
  where s.journey_id = p_journey_id and s.owner_id = v_user and s.revoked_at is null;
  if not exists (
    select 1 from public.location_shares s
    where s.owner_id = v_user and s.revoked_at is null and s.expires_at > now()
  ) then
    delete from public.live_locations l where l.user_id = v_user;
  end if;
end;
$$;

create or replace function public.stop_all_location_sharing()
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Sign in to stop location sharing.'; end if;
  update public.location_shares s set revoked_at = coalesce(s.revoked_at, now())
  where s.owner_id = v_user and s.revoked_at is null;
  update public.safety_journeys j set ended_at = coalesce(j.ended_at, now())
  where j.owner_id = v_user and j.ended_at is null;
  delete from public.live_locations l where l.user_id = v_user;
end;
$$;

create or replace function public.cleanup_expired_location_sharing()
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Sign in to clean up expired sharing sessions.'; end if;
  update public.location_shares s
  set revoked_at = coalesce(s.revoked_at, now())
  where s.owner_id = v_user and s.revoked_at is null and s.expires_at <= now();
  update public.safety_journeys j
  set ended_at = coalesce(j.ended_at, now())
  where j.owner_id = v_user and j.ended_at is null
    and not exists (
      select 1 from public.location_shares s
      where s.journey_id = j.id and s.revoked_at is null and s.expires_at > now()
    );
  delete from public.live_locations l
  where l.user_id = v_user
    and not exists (
      select 1 from public.location_shares s
      where s.owner_id = v_user and s.revoked_at is null and s.expires_at > now()
    );
  delete from public.sos_alerts a
  where a.owner_id = v_user and a.expires_at <= now();
end;
$$;

create or replace function public.create_sos_alert(
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy double precision,
  p_contact_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_alert uuid;
  v_contact_count integer := coalesce(cardinality(p_contact_ids), 0);
begin
  if v_owner is null then raise exception 'Sign in to create an emergency alert.'; end if;
  if v_contact_count < 1 or v_contact_count > 10 then raise exception 'Select between 1 and 10 accepted trusted contacts.'; end if;
  if (p_latitude is null) <> (p_longitude is null)
    or (p_latitude is not null and (p_latitude not between -90 and 90 or p_longitude not between -180 and 180))
    or (p_accuracy is not null and p_accuracy not between 0 and 100000) then
    raise exception 'Emergency alert coordinates are invalid.';
  end if;
  if (
    select count(*) from public.trusted_contacts tc
    where tc.id = any(p_contact_ids) and tc.owner_id = v_owner
      and tc.status = 'accepted' and tc.contact_user_id is not null
  ) <> v_contact_count then
    raise exception 'Every alert recipient must be an accepted trusted contact.';
  end if;

  insert into public.sos_alerts (owner_id, latitude, longitude, accuracy)
  values (v_owner, p_latitude, p_longitude, p_accuracy)
  returning id into v_alert;

  insert into public.sos_alert_recipients (alert_id, owner_id, recipient_user_id, contact_id)
  select v_alert, v_owner, tc.contact_user_id, tc.id
  from public.trusted_contacts tc
  where tc.id = any(p_contact_ids)
    and tc.owner_id = v_owner and tc.status = 'accepted';
  return v_alert;
end;
$$;

create or replace function public.acknowledge_sos_alert(p_alert_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Sign in to acknowledge an alert.'; end if;
  update public.sos_alert_recipients r
  set status = 'acknowledged', acknowledged_at = now()
  where r.alert_id = p_alert_id and r.recipient_user_id = auth.uid()
    and r.status = 'pending'
    and exists (
      select 1 from public.sos_alerts a
      where a.id = p_alert_id and a.status = 'active' and a.expires_at > now()
    );
  if not found then raise exception 'No active pending alert was found for this account.'; end if;
end;
$$;

create or replace function public.cancel_sos_alert(p_alert_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Sign in to cancel an alert.'; end if;
  update public.sos_alerts a set status = 'cancelled', cancelled_at = now()
  where a.id = p_alert_id and a.owner_id = auth.uid() and a.status = 'active';
  if not found then raise exception 'Active alert not found or already cancelled.'; end if;
  update public.sos_alert_recipients r set status = 'cancelled'
  where r.alert_id = p_alert_id and r.owner_id = auth.uid() and r.status = 'pending';
end;
$$;

revoke all on public.trusted_contacts, public.safety_journeys, public.location_shares,
  public.live_locations, public.location_update_limits, public.sos_alerts, public.sos_alert_recipients from public, anon, authenticated;
grant select on public.trusted_contacts, public.location_shares, public.safety_journeys,
  public.live_locations, public.sos_alerts, public.sos_alert_recipients to authenticated;
grant insert, update on public.safety_journeys to authenticated;

revoke all on function public.publish_current_location(double precision, double precision, double precision, timestamptz) from public, anon;
revoke all on function public.create_trusted_contact_invite(text, text) from public, anon;
revoke all on function public.accept_trusted_contact_invite(uuid) from public, anon;
revoke all on function public.revoke_trusted_contact(uuid) from public, anon;
revoke all on function public.start_safety_journey(text, double precision, double precision, text, double precision, double precision, double precision, double precision, uuid[], integer) from public, anon;
revoke all on function public.stop_safety_journey(uuid) from public, anon;
revoke all on function public.stop_all_location_sharing() from public, anon;
revoke all on function public.cleanup_expired_location_sharing() from public, anon;
revoke all on function public.create_sos_alert(double precision, double precision, double precision, uuid[]) from public, anon;
revoke all on function public.acknowledge_sos_alert(uuid) from public, anon;
revoke all on function public.cancel_sos_alert(uuid) from public, anon;

grant execute on function public.create_trusted_contact_invite(text, text) to authenticated;
grant execute on function public.publish_current_location(double precision, double precision, double precision, timestamptz) to authenticated;
grant execute on function public.accept_trusted_contact_invite(uuid) to authenticated;
grant execute on function public.revoke_trusted_contact(uuid) to authenticated;
grant execute on function public.start_safety_journey(text, double precision, double precision, text, double precision, double precision, double precision, double precision, uuid[], integer) to authenticated;
grant execute on function public.stop_safety_journey(uuid) to authenticated;
grant execute on function public.stop_all_location_sharing() to authenticated;
grant execute on function public.cleanup_expired_location_sharing() to authenticated;
grant execute on function public.create_sos_alert(double precision, double precision, double precision, uuid[]) to authenticated;
grant execute on function public.acknowledge_sos_alert(uuid) to authenticated;
grant execute on function public.cancel_sos_alert(uuid) to authenticated;

do $$
declare
  v_table text;
begin
  foreach v_table in array array['live_locations', 'sos_alert_recipients'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end;
$$;
