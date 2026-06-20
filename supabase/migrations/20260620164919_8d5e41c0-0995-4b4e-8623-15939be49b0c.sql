
-- conversations
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS remote_jid text,
  ADD COLUMN IF NOT EXISTS provider text DEFAULT 'evolution';
CREATE UNIQUE INDEX IF NOT EXISTS conversations_tenant_jid_uniq
  ON public.conversations (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), remote_jid)
  WHERE remote_jid IS NOT NULL;

-- messages
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS direction text,
  ADD COLUMN IF NOT EXISTS wamid text,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'sent';
CREATE UNIQUE INDEX IF NOT EXISTS messages_wamid_uniq ON public.messages (wamid) WHERE wamid IS NOT NULL;

-- zapi_connections: add webhook secret
ALTER TABLE public.zapi_connections
  ADD COLUMN IF NOT EXISTS webhook_secret text;

-- leads: ad and adset ids + unique facebook lead id
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS facebook_ad_id text,
  ADD COLUMN IF NOT EXISTS facebook_adset_id text;
CREATE UNIQUE INDEX IF NOT EXISTS leads_facebook_lead_id_uniq
  ON public.leads (facebook_lead_id) WHERE facebook_lead_id IS NOT NULL;

-- campaign_spend: status for "AO VIVO" badge
ALTER TABLE public.campaign_spend
  ADD COLUMN IF NOT EXISTS campaign_status text;

-- realtime
ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.conversations REPLICA IDENTITY FULL;
DO $$ BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.messages; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- extensions for cron
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
