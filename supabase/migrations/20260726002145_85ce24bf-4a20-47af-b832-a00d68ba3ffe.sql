
-- 1) Quarantine all currently active poisoned alias sinks
--    (any phone_jid with more than 1 non-quarantined alias mapping).
WITH poisoned AS (
  SELECT tenant_scope, phone_jid
  FROM public.whatsapp_jid_aliases
  WHERE quarantined_at IS NULL
  GROUP BY tenant_scope, phone_jid
  HAVING count(*) > 1
)
UPDATE public.whatsapp_jid_aliases a
SET quarantined_at = now(),
    quarantine_reason = COALESCE(a.quarantine_reason, 'auto: poisoned sink (multiple LIDs → same phone)')
FROM poisoned p
WHERE a.tenant_scope = p.tenant_scope
  AND a.phone_jid = p.phone_jid
  AND a.quarantined_at IS NULL;

-- 2) Trigger: whenever a new alias is inserted/updated as active, if that phone_jid
--    already has another active alias in the same tenant scope, auto-quarantine
--    ALL of them (safe default — prevents future poisoning).
CREATE OR REPLACE FUNCTION public.trg_quarantine_poisoned_alias_sink()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  active_count int;
BEGIN
  IF NEW.quarantined_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO active_count
  FROM public.whatsapp_jid_aliases
  WHERE tenant_scope IS NOT DISTINCT FROM NEW.tenant_scope
    AND phone_jid = NEW.phone_jid
    AND quarantined_at IS NULL
    AND id <> NEW.id;
  IF active_count >= 1 THEN
    UPDATE public.whatsapp_jid_aliases
    SET quarantined_at = now(),
        quarantine_reason = COALESCE(quarantine_reason, 'auto: poisoned sink detected on insert/update')
    WHERE tenant_scope IS NOT DISTINCT FROM NEW.tenant_scope
      AND phone_jid = NEW.phone_jid
      AND quarantined_at IS NULL;
    NEW.quarantined_at := now();
    NEW.quarantine_reason := COALESCE(NEW.quarantine_reason, 'auto: poisoned sink detected on insert/update');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quarantine_poisoned_alias_sink ON public.whatsapp_jid_aliases;
CREATE TRIGGER quarantine_poisoned_alias_sink
BEFORE INSERT OR UPDATE OF phone_jid, quarantined_at ON public.whatsapp_jid_aliases
FOR EACH ROW EXECUTE FUNCTION public.trg_quarantine_poisoned_alias_sink();
