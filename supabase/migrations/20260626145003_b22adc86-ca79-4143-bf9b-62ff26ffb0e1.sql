alter table public.zapi_connections enable row level security;
alter table public.whatsapp_welcome_config enable row level security;

grant select, insert, update, delete on public.zapi_connections to authenticated;
grant all on public.zapi_connections to service_role;
grant select, insert, update, delete on public.whatsapp_welcome_config to authenticated;
grant all on public.whatsapp_welcome_config to service_role;

drop policy if exists "Tenant admins manage zapi_connections" on public.zapi_connections;
drop policy if exists "tenant access zapi_connections" on public.zapi_connections;
drop policy if exists "Tenant members manage zapi_connections" on public.zapi_connections;
drop policy if exists "Master admin manages zapi_connections" on public.zapi_connections;

create policy "Master admin manages zapi_connections"
  on public.zapi_connections
  for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

create policy "Tenant members manage zapi_connections"
  on public.zapi_connections
  for all
  to authenticated
  using (tenant_id is not null and public.has_tenant_access(auth.uid(), tenant_id))
  with check (tenant_id is not null and public.has_tenant_access(auth.uid(), tenant_id));

drop policy if exists "tenant admin manages welcome" on public.whatsapp_welcome_config;
drop policy if exists "tenant members manage welcome" on public.whatsapp_welcome_config;
drop policy if exists "Master admin manages welcome" on public.whatsapp_welcome_config;
drop policy if exists "Tenant members manage welcome" on public.whatsapp_welcome_config;

create policy "Master admin manages welcome"
  on public.whatsapp_welcome_config
  for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

create policy "Tenant members manage welcome"
  on public.whatsapp_welcome_config
  for all
  to authenticated
  using (tenant_id is not null and public.has_tenant_access(auth.uid(), tenant_id))
  with check (tenant_id is not null and public.has_tenant_access(auth.uid(), tenant_id));

drop policy if exists "wa media authenticated write" on storage.objects;
create policy "wa media authenticated write"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'whatsapp-media');

update public.zapi_connections
set instance_url = split_part(instance_url, '/manager', 1),
    updated_at = now()
where provider = 'evolution'
  and instance_url ilike '%/manager%';