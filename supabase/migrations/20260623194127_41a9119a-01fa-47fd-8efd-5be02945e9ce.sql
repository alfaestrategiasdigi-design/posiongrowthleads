
-- Mídia em messages
alter table public.messages add column if not exists media_type text;
alter table public.messages add column if not exists media_mime text;
alter table public.messages add column if not exists tipo_disparo text;
create index if not exists messages_conversation_created_idx on public.messages(conversation_id, created_at desc);

-- conversation_tags
create table if not exists public.conversation_tags (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  nome text not null,
  cor text not null default '#c9a84c',
  created_at timestamptz not null default now(),
  unique(tenant_id, nome)
);
grant select, insert, update, delete on public.conversation_tags to authenticated;
grant all on public.conversation_tags to service_role;
alter table public.conversation_tags enable row level security;
create policy "tenant or admin manage tags"
  on public.conversation_tags for all to authenticated
  using (public.has_role(auth.uid(),'admin') or (tenant_id is not null and public.has_tenant_access(auth.uid(), tenant_id)))
  with check (public.has_role(auth.uid(),'admin') or (tenant_id is not null and public.has_tenant_access(auth.uid(), tenant_id)));

-- conversation_tag_assignments
create table if not exists public.conversation_tag_assignments (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  tag_id uuid not null references public.conversation_tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(conversation_id, tag_id)
);
grant select, insert, delete on public.conversation_tag_assignments to authenticated;
grant all on public.conversation_tag_assignments to service_role;
alter table public.conversation_tag_assignments enable row level security;
create policy "tag assignments via conversation access"
  on public.conversation_tag_assignments for all to authenticated
  using (
    public.has_role(auth.uid(),'admin')
    or exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (c.tenant_id is null or public.has_tenant_access(auth.uid(), c.tenant_id))
    )
  )
  with check (
    public.has_role(auth.uid(),'admin')
    or exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (c.tenant_id is null or public.has_tenant_access(auth.uid(), c.tenant_id))
    )
  );

-- whatsapp_welcome_config
create table if not exists public.whatsapp_welcome_config (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid unique references public.tenants(id) on delete cascade,
  enabled boolean not null default false,
  message_template text not null default 'Olá {{nome}}, obrigado pelo interesse! Em breve um consultor entrará em contato.',
  delay_seconds integer not null default 30,
  trigger_form boolean not null default true,
  trigger_facebook boolean not null default true,
  trigger_kanban_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.whatsapp_welcome_config to authenticated;
grant all on public.whatsapp_welcome_config to service_role;
alter table public.whatsapp_welcome_config enable row level security;
create policy "tenant admin manages welcome"
  on public.whatsapp_welcome_config for all to authenticated
  using (public.has_role(auth.uid(),'admin') or (tenant_id is null) or public.is_tenant_admin(auth.uid(), tenant_id))
  with check (public.has_role(auth.uid(),'admin') or (tenant_id is null) or public.is_tenant_admin(auth.uid(), tenant_id));

create trigger trg_welcome_updated_at before update on public.whatsapp_welcome_config
  for each row execute function public.update_updated_at_column();

-- Extensions for cron/net
create extension if not exists pg_net;

-- Trigger: dispara boas-vindas em lead novo
create or replace function public.fire_welcome_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text := 'https://mbhbflbuawkmtmpjazcj.supabase.co/functions/v1/whatsapp-send-welcome';
  v_origem text := coalesce(new.origem, 'formulario');
  v_trigger boolean := false;
  v_cfg record;
begin
  if new.whatsapp is null or length(trim(new.whatsapp)) < 8 then
    return new;
  end if;

  select * into v_cfg from public.whatsapp_welcome_config
   where (tenant_id = new.tenant_id) or (new.tenant_id is null and tenant_id is null)
   order by tenant_id nulls last limit 1;

  if v_cfg is null or not v_cfg.enabled then
    return new;
  end if;

  if v_origem ilike 'facebook%' then
    v_trigger := v_cfg.trigger_facebook;
  else
    v_trigger := v_cfg.trigger_form;
  end if;

  if not v_trigger then return new; end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type','application/json'),
    body := jsonb_build_object('lead_id', new.id)
  );

  return new;
end;
$$;

drop trigger if exists trg_fire_welcome on public.leads;
create trigger trg_fire_welcome after insert on public.leads
  for each row execute function public.fire_welcome_message();

-- Realtime
do $$ begin
  perform 1; 
  begin
    alter publication supabase_realtime add table public.messages;
  exception when duplicate_object then null; end;
  begin
    alter publication supabase_realtime add table public.conversations;
  exception when duplicate_object then null; end;
  begin
    alter publication supabase_realtime add table public.conversation_tag_assignments;
  exception when duplicate_object then null; end;
end $$;
