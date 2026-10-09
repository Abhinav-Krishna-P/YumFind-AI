-- Shared tables are written only by the API server (service role, which bypasses RLS).
-- Signed-in users may read places and reviews (the Profile page joins visits to places);
-- they may not write them, and they get no direct access to embeddings or cached searches.
-- Before this, any signed-in user could insert, change or delete shared places, reviews and
-- cached rankings with the public key.

drop policy if exists places_rw on public.places;
drop policy if exists reviews_rw on public.place_reviews;
drop policy if exists chunks_rw on public.review_chunks;
drop policy if exists nearby_rw on public.nearby_snapshots;
drop policy if exists search_rw on public.search_snapshots;

drop policy if exists places_read on public.places;
drop policy if exists reviews_read on public.place_reviews;
create policy places_read on public.places
  for select to authenticated using (true);
create policy reviews_read on public.place_reviews
  for select to authenticated using (true);

revoke insert, update, delete on public.places from authenticated;
revoke insert, update, delete on public.place_reviews from authenticated;
revoke all on public.review_chunks from authenticated;
revoke all on public.nearby_snapshots from authenticated;
revoke all on public.search_snapshots from authenticated;
revoke all on public.places, public.place_reviews, public.review_chunks, public.nearby_snapshots, public.search_snapshots from anon;

-- Users can read their own searches and visits; the server records them.
revoke update, delete on public.searches from authenticated;
