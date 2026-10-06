create extension if not exists vector with schema extensions;
grant usage on schema extensions to authenticated, service_role;

create schema if not exists private;
revoke all on schema private from public;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.places (
  id uuid primary key default gen_random_uuid(),
  data_id text not null unique,
  google_place_id text,
  name text not null,
  address text,
  lat double precision not null,
  lng double precision not null,
  rating numeric,
  reviews_count int,
  price_level int,
  open_now boolean,
  thumbnail text,
  phone text,
  website text,
  raw jsonb,
  fetched_at timestamptz not null default now(),
  static_expires_at timestamptz not null default (now() + interval '24 hours'),
  reviews_cached_at timestamptz
);

create unique index if not exists places_google_place_id_uidx
  on public.places (google_place_id)
  where google_place_id is not null;

create table if not exists public.place_reviews (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references public.places (id) on delete cascade,
  source_review_id text not null,
  author text,
  rating numeric,
  snippet text not null,
  published_at timestamptz not null,
  fetched_at timestamptz not null default now(),
  unique (place_id, source_review_id)
);

create index if not exists place_reviews_place_published_idx
  on public.place_reviews (place_id, published_at desc);

create table if not exists public.review_chunks (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references public.places (id) on delete cascade,
  content text not null,
  embedding extensions.vector(768),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists review_chunks_place_idx
  on public.review_chunks (place_id);

create index if not exists review_chunks_embedding_idx
  on public.review_chunks
  using hnsw (embedding extensions.vector_cosine_ops);

create table if not exists public.searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  query_text text not null,
  lat double precision not null,
  lng double precision not null,
  radius_m int not null,
  budget text not null,
  preferences jsonb not null default '[]'::jsonb,
  addons jsonb not null default '[]'::jsonb,
  result_place_ids uuid[] not null default '{}',
  cache_hit boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists searches_user_created_idx
  on public.searches (user_id, created_at desc);

create table if not exists public.place_visits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  place_id uuid not null references public.places (id) on delete cascade,
  visited_at timestamptz not null default now()
);

create index if not exists place_visits_user_visited_idx
  on public.place_visits (user_id, visited_at desc);

create table if not exists public.nearby_snapshots (
  geohash text primary key,
  place_ids uuid[] not null,
  expires_at timestamptz not null
);

create table if not exists public.search_snapshots (
  fingerprint text primary key,
  place_ids uuid[] not null,
  score_json jsonb not null,
  expires_at timestamptz not null
);

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data->>'display_name', ''),
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$func$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

alter table public.profiles enable row level security;
alter table public.places enable row level security;
alter table public.place_reviews enable row level security;
alter table public.review_chunks enable row level security;
alter table public.searches enable row level security;
alter table public.place_visits enable row level security;
alter table public.nearby_snapshots enable row level security;
alter table public.search_snapshots enable row level security;

drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_insert on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (id = auth.uid());
create policy profiles_insert on public.profiles
  for insert to authenticated with check (id = auth.uid());
create policy profiles_update on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists searches_own on public.searches;
create policy searches_own on public.searches
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists visits_select on public.place_visits;
drop policy if exists visits_insert on public.place_visits;
create policy visits_select on public.place_visits
  for select to authenticated using (user_id = auth.uid());
create policy visits_insert on public.place_visits
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists places_rw on public.places;
drop policy if exists reviews_rw on public.place_reviews;
drop policy if exists chunks_rw on public.review_chunks;
drop policy if exists nearby_rw on public.nearby_snapshots;
drop policy if exists search_rw on public.search_snapshots;

create policy places_rw on public.places
  for all to authenticated using (true) with check (true);
create policy reviews_rw on public.place_reviews
  for all to authenticated using (true) with check (true);
create policy chunks_rw on public.review_chunks
  for all to authenticated using (true) with check (true);
create policy nearby_rw on public.nearby_snapshots
  for all to authenticated using (true) with check (true);
create policy search_rw on public.search_snapshots
  for all to authenticated using (true) with check (true);

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.searches to authenticated;
grant select, insert on public.place_visits to authenticated;
grant select, insert, update, delete on public.places to authenticated;
grant select, insert, update, delete on public.place_reviews to authenticated;
grant select, insert, update, delete on public.review_chunks to authenticated;
grant select, insert, update, delete on public.nearby_snapshots to authenticated;
grant select, insert, update, delete on public.search_snapshots to authenticated;
