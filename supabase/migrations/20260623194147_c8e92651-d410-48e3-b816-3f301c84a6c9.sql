
create policy "wa media authenticated read"
on storage.objects for select to authenticated
using (bucket_id = 'whatsapp-media');

create policy "wa media service write"
on storage.objects for insert to service_role
with check (bucket_id = 'whatsapp-media');
