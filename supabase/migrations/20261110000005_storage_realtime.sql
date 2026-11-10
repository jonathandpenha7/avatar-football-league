-- Storage bucket for tournament and team logos, plus realtime publication.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tournament-assets', 'tournament-assets', true, 2097152,
        array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif'])
on conflict (id) do nothing;

-- Files are stored as <tournament_id>/<filename>; only that tournament's admins may write.
create policy "tournament assets are public" on storage.objects for select
  using (bucket_id = 'tournament-assets');

create policy "tournament admins upload assets" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'tournament-assets'
    and private.is_admin(nullif((storage.foldername(name))[1], '')::uuid)
  );

create policy "tournament admins update assets" on storage.objects for update to authenticated
  using (bucket_id = 'tournament-assets' and private.is_admin(nullif((storage.foldername(name))[1], '')::uuid));

create policy "tournament admins delete assets" on storage.objects for delete to authenticated
  using (bucket_id = 'tournament-assets' and private.is_admin(nullif((storage.foldername(name))[1], '')::uuid));

-- Live updates for match centre and public pages (RLS still applies to realtime).
alter publication supabase_realtime add table public.fixtures, public.match_events;
alter table public.fixtures replica identity full;
alter table public.match_events replica identity full;
