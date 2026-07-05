
ALTER TABLE public.whatsapp_jid_aliases
  ADD COLUMN IF NOT EXISTS quarantined_at timestamptz,
  ADD COLUMN IF NOT EXISTS quarantine_reason text;

CREATE INDEX IF NOT EXISTS whatsapp_jid_aliases_active_lookup_idx
  ON public.whatsapp_jid_aliases (lid_jid, tenant_id)
  WHERE quarantined_at IS NULL;
