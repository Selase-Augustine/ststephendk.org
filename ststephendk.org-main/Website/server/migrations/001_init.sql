create extension if not exists pgcrypto;
create extension if not exists citext;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type user_role as enum ('super_admin', 'parish_priest', 'editor', 'communications', 'finance_admin');
  end if;

  if not exists (select 1 from pg_type where typname = 'user_status') then
    create type user_status as enum ('active', 'suspended', 'disabled');
  end if;

  if not exists (select 1 from pg_type where typname = 'content_status') then
    create type content_status as enum ('draft', 'published', 'archived');
  end if;

  if not exists (select 1 from pg_type where typname = 'message_status') then
    create type message_status as enum ('unread', 'read', 'archived');
  end if;

  if not exists (select 1 from pg_type where typname = 'donation_payment_method') then
    create type donation_payment_method as enum ('MTN MoMo', 'Telecel Cash', 'AirtelTigo Cash', 'Card', 'Bank Transfer');
  end if;

  if not exists (select 1 from pg_type where typname = 'payment_status') then
    create type payment_status as enum ('pending', 'completed', 'failed', 'reversed');
  end if;

  if not exists (select 1 from pg_type where typname = 'registration_type') then
    create type registration_type as enum ('Membership', 'Baptism', 'Marriage', 'Youth Registration');
  end if;
end
$$;

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email citext not null unique,
  password_hash text not null,
  role user_role not null,
  profile_image text,
  phone_number text,
  status user_status not null default 'active',
  last_login timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger users_set_updated_at
before update on users
for each row
execute function set_updated_at();

create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  content text not null,
  featured_image text,
  author_id uuid not null references users(id) on delete restrict,
  status content_status not null default 'draft',
  publish_date timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists announcements_status_idx on announcements(status);
create index if not exists announcements_publish_date_idx on announcements(publish_date desc);
create index if not exists announcements_author_idx on announcements(author_id);

create trigger announcements_set_updated_at
before update on announcements
for each row
execute function set_updated_at();

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  description text not null,
  event_date date not null,
  start_time time,
  end_time time,
  venue text,
  poster_image text,
  registration_link text,
  status content_status not null default 'draft',
  created_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists events_event_date_idx on events(event_date desc);
create index if not exists events_status_idx on events(status);
create index if not exists events_created_by_idx on events(created_by);

create trigger events_set_updated_at
before update on events
for each row
execute function set_updated_at();

create table if not exists bulletins (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  pdf_url text not null unique,
  thumbnail text,
  month smallint not null check (month between 1 and 12),
  year int not null check (year between 1900 and 2100),
  uploaded_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bulletins_year_month_idx on bulletins(year desc, month desc);
create index if not exists bulletins_uploaded_by_idx on bulletins(uploaded_by);

create trigger bulletins_set_updated_at
before update on bulletins
for each row
execute function set_updated_at();

create table if not exists albums (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  cover_image text,
  created_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists albums_created_by_idx on albums(created_by);
create index if not exists albums_created_at_idx on albums(created_at desc);

create trigger albums_set_updated_at
before update on albums
for each row
execute function set_updated_at();

create table if not exists gallery_images (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references albums(id) on delete cascade,
  image_url text not null,
  caption text,
  uploaded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists gallery_images_album_idx on gallery_images(album_id);
create index if not exists gallery_images_uploaded_at_idx on gallery_images(uploaded_at desc);

create trigger gallery_images_set_updated_at
before update on gallery_images
for each row
execute function set_updated_at();

create table if not exists mass_schedules (
  id uuid primary key default gen_random_uuid(),
  mass_type text not null,
  day text not null check (day in ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')),
  start_time time not null,
  venue text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mass_schedules_day_idx on mass_schedules(day);
create index if not exists mass_schedules_start_time_idx on mass_schedules(start_time);

create trigger mass_schedules_set_updated_at
before update on mass_schedules
for each row
execute function set_updated_at();

create table if not exists parish_groups (
  id uuid primary key default gen_random_uuid(),
  group_name text not null,
  description text not null,
  patron text,
  meeting_day text,
  meeting_time time,
  cover_image text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists parish_groups_group_name_idx on parish_groups(group_name);
create index if not exists parish_groups_created_at_idx on parish_groups(created_at desc);

create trigger parish_groups_set_updated_at
before update on parish_groups
for each row
execute function set_updated_at();

create table if not exists group_executives (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references parish_groups(id) on delete cascade,
  executive_name text not null,
  position text not null,
  phone text,
  image text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists group_executives_group_idx on group_executives(group_id);
create index if not exists group_executives_position_idx on group_executives(position);

create trigger group_executives_set_updated_at
before update on group_executives
for each row
execute function set_updated_at();

create table if not exists livestreams (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  youtube_url text,
  facebook_url text,
  scheduled_date timestamptz not null,
  created_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists livestreams_scheduled_date_idx on livestreams(scheduled_date desc);
create index if not exists livestreams_created_by_idx on livestreams(created_by);

create trigger livestreams_set_updated_at
before update on livestreams
for each row
execute function set_updated_at();

create table if not exists donations (
  id uuid primary key default gen_random_uuid(),
  donor_name text not null,
  donor_email citext,
  amount numeric(12,2) not null check (amount > 0),
  payment_method donation_payment_method not null,
  transaction_reference text,
  donation_type text,
  payment_status payment_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists donations_created_at_idx on donations(created_at desc);
create index if not exists donations_payment_status_idx on donations(payment_status);
create index if not exists donations_transaction_reference_idx on donations(transaction_reference);
create index if not exists donations_donor_email_idx on donations(donor_email);

create trigger donations_set_updated_at
before update on donations
for each row
execute function set_updated_at();

create table if not exists registrations (
  id uuid primary key default gen_random_uuid(),
  registration_type registration_type not null,
  first_name text not null,
  last_name text not null,
  email citext,
  phone text,
  address text,
  additional_data jsonb not null default '{}'::jsonb,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists registrations_type_idx on registrations(registration_type);
create index if not exists registrations_submitted_at_idx on registrations(submitted_at desc);
create index if not exists registrations_email_idx on registrations(email);

create trigger registrations_set_updated_at
before update on registrations
for each row
execute function set_updated_at();

create table if not exists contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email citext not null,
  subject text not null,
  message text not null,
  status message_status not null default 'unread',
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists contact_messages_status_idx on contact_messages(status);
create index if not exists contact_messages_submitted_at_idx on contact_messages(submitted_at desc);

create trigger contact_messages_set_updated_at
before update on contact_messages
for each row
execute function set_updated_at();

create table if not exists seo_settings (
  id uuid primary key default gen_random_uuid(),
  page_name text not null unique,
  meta_title text,
  meta_description text,
  keywords text,
  og_image text,
  updated_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  action text not null,
  module text not null,
  record_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_created_at_idx on audit_logs(created_at desc);
create index if not exists audit_logs_user_idx on audit_logs(user_id);
create index if not exists audit_logs_module_idx on audit_logs(module);

