
-- 1) Extend messages
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS reply_to_wamid text,
  ADD COLUMN IF NOT EXISTS reply_preview text,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS location jsonb,
  ADD COLUMN IF NOT EXISTS contact_card jsonb;

CREATE INDEX IF NOT EXISTS idx_messages_wamid ON public.messages(wamid) WHERE wamid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON public.messages(reply_to_wamid) WHERE reply_to_wamid IS NOT NULL;

-- 2) Extend conversations
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS pinned_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS marked_unread boolean DEFAULT false;

-- 3) Reactions
CREATE TABLE IF NOT EXISTS public.message_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  message_wamid text NOT NULL,
  actor_jid text NOT NULL,
  from_me boolean DEFAULT false,
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_wamid, actor_jid)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_reactions TO authenticated;
GRANT ALL ON public.message_reactions TO service_role;

ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members read reactions"
  ON public.message_reactions FOR SELECT TO authenticated
  USING (
    tenant_id IS NULL AND public.has_role(auth.uid(), 'admin')
    OR (tenant_id IS NOT NULL AND public.has_tenant_access(auth.uid(), tenant_id))
  );

CREATE POLICY "Tenant members insert reactions"
  ON public.message_reactions FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id IS NULL AND public.has_role(auth.uid(), 'admin')
    OR (tenant_id IS NOT NULL AND public.has_tenant_access(auth.uid(), tenant_id))
  );

CREATE POLICY "Tenant members delete reactions"
  ON public.message_reactions FOR DELETE TO authenticated
  USING (
    tenant_id IS NULL AND public.has_role(auth.uid(), 'admin')
    OR (tenant_id IS NOT NULL AND public.has_tenant_access(auth.uid(), tenant_id))
  );

-- 4) Realtime
ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.conversations REPLICA IDENTITY FULL;
ALTER TABLE public.message_reactions REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reactions;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
