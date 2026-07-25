
-- 1) Anti-join RPC to bypass PostgREST's 1000-row cap when deduplicating imports.
CREATE OR REPLACE FUNCTION public.leads_existing_by_norm_phone(
  p_tenant_id uuid,
  p_phones    text[]
)
RETURNS TABLE(norm text, id uuid, nome_completo text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (public.normalize_phone(l.whatsapp))
         public.normalize_phone(l.whatsapp) AS norm,
         l.id,
         l.nome_completo
    FROM public.leads l
   WHERE (
           (p_tenant_id IS NULL     AND l.tenant_id IS NULL) OR
           (p_tenant_id IS NOT NULL AND l.tenant_id = p_tenant_id)
         )
     AND l.whatsapp IS NOT NULL
     AND public.normalize_phone(l.whatsapp) = ANY(p_phones)
   ORDER BY public.normalize_phone(l.whatsapp), l.created_at ASC;
$$;

REVOKE ALL ON FUNCTION public.leads_existing_by_norm_phone(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leads_existing_by_norm_phone(uuid, text[]) TO service_role, authenticated;

-- 2) One-shot dedup routine. Returns (groups, removed) counters.
CREATE OR REPLACE FUNCTION public.dedupe_whatsapp_import_leads()
RETURNS TABLE(groups_processed integer, leads_removed integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_keeper uuid;
  v_losers uuid[];
  v_groups int := 0;
  v_removed int := 0;
BEGIN
  FOR r IN
    WITH scoped AS (
      SELECT id, tenant_id, created_at,
             public.normalize_phone(whatsapp) AS norm
        FROM public.leads
       WHERE origem IN ('whatsapp_import','whatsapp')
         AND whatsapp IS NOT NULL
         AND public.normalize_phone(whatsapp) IS NOT NULL
         AND length(public.normalize_phone(whatsapp)) >= 8
    ),
    grp AS (
      SELECT tenant_id, norm, count(*) AS n
        FROM scoped
       GROUP BY 1,2
      HAVING count(*) > 1
    )
    SELECT g.tenant_id, g.norm
      FROM grp g
     ORDER BY g.tenant_id NULLS FIRST, g.norm
  LOOP
    -- Pick keeper: prefer one that is already linked to a conversation,
    -- otherwise the oldest by created_at.
    SELECT l.id INTO v_keeper
      FROM public.leads l
     WHERE l.origem IN ('whatsapp_import','whatsapp')
       AND (
             (r.tenant_id IS NULL AND l.tenant_id IS NULL) OR
             (r.tenant_id IS NOT NULL AND l.tenant_id = r.tenant_id)
           )
       AND public.normalize_phone(l.whatsapp) = r.norm
     ORDER BY
       EXISTS (SELECT 1 FROM public.conversations c WHERE c.lead_id = l.id) DESC,
       l.created_at ASC,
       l.id ASC
     LIMIT 1;

    IF v_keeper IS NULL THEN
      CONTINUE;
    END IF;

    -- Collect losers (all others in the group).
    SELECT array_agg(l.id) INTO v_losers
      FROM public.leads l
     WHERE l.origem IN ('whatsapp_import','whatsapp')
       AND (
             (r.tenant_id IS NULL AND l.tenant_id IS NULL) OR
             (r.tenant_id IS NOT NULL AND l.tenant_id = r.tenant_id)
           )
       AND public.normalize_phone(l.whatsapp) = r.norm
       AND l.id <> v_keeper;

    IF v_losers IS NULL OR array_length(v_losers, 1) IS NULL THEN
      CONTINUE;
    END IF;

    -- Reassign references to keeper before deleting losers so nothing is lost.
    UPDATE public.conversations SET lead_id = v_keeper
      WHERE lead_id = ANY(v_losers)
        AND NOT EXISTS (SELECT 1 FROM public.conversations c2 WHERE c2.lead_id = v_keeper AND c2.id = public.conversations.id);
    UPDATE public.conversations SET lead_id = NULL
      WHERE lead_id = ANY(v_losers);

    UPDATE public.appointments        SET lead_id = v_keeper WHERE lead_id = ANY(v_losers);
    UPDATE public.lead_tasks          SET lead_id = v_keeper WHERE lead_id = ANY(v_losers);
    UPDATE public.campaign_lead_links SET lead_id = v_keeper WHERE lead_id = ANY(v_losers);
    UPDATE public.agency_leads        SET source_lead_id = v_keeper WHERE source_lead_id = ANY(v_losers);
    UPDATE public.patients            SET source_form_lead_id = v_keeper WHERE source_form_lead_id = ANY(v_losers);

    -- Loose references (no FK, but keep them consistent).
    UPDATE public.sales                 SET lead_id = v_keeper WHERE lead_id = ANY(v_losers);
    UPDATE public.lead_status_events    SET lead_id = v_keeper WHERE lead_id = ANY(v_losers);
    UPDATE public.medical_records       SET lead_id = v_keeper WHERE lead_id = ANY(v_losers);
    UPDATE public.automation_executions SET lead_id = v_keeper WHERE lead_id = ANY(v_losers);
    UPDATE public.automation_tasks      SET lead_id = v_keeper WHERE lead_id = ANY(v_losers);
    UPDATE public.recall_executions     SET lead_id = v_keeper WHERE lead_id = ANY(v_losers);
    UPDATE public.capi_events_sent      SET lead_id = v_keeper WHERE lead_id = ANY(v_losers);
    UPDATE public.facebook_capi_logs    SET lead_id = v_keeper WHERE lead_id = ANY(v_losers);
    UPDATE public.facebook_webhook_events SET lead_id = v_keeper WHERE lead_id = ANY(v_losers);

    DELETE FROM public.leads WHERE id = ANY(v_losers);

    v_groups := v_groups + 1;
    v_removed := v_removed + array_length(v_losers, 1);
  END LOOP;

  groups_processed := v_groups;
  leads_removed := v_removed;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.dedupe_whatsapp_import_leads() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dedupe_whatsapp_import_leads() TO service_role;

-- 3) Backfill missing conversations for WhatsApp leads.
CREATE OR REPLACE FUNCTION public.backfill_whatsapp_lead_conversations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_created int := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT l.id, l.tenant_id, l.nome_completo,
           public.normalize_phone(l.whatsapp) AS phone
      FROM public.leads l
     WHERE l.origem IN ('whatsapp_import','whatsapp')
       AND l.whatsapp IS NOT NULL
       AND public.normalize_phone(l.whatsapp) IS NOT NULL
       AND length(public.normalize_phone(l.whatsapp)) BETWEEN 8 AND 15
       AND NOT EXISTS (SELECT 1 FROM public.conversations c WHERE c.lead_id = l.id)
  LOOP
    BEGIN
      INSERT INTO public.conversations (
        tenant_id, telefone, remote_jid, nome_contato, provider,
        lead_id, ultima_mensagem, ultima_interacao
      ) VALUES (
        r.tenant_id, r.phone, r.phone || '@s.whatsapp.net',
        COALESCE(r.nome_completo, '+' || r.phone),
        'evolution', r.id, 'Lead importado da campanha de WhatsApp', now()
      );
      v_created := v_created + 1;
    EXCEPTION WHEN unique_violation THEN
      -- Conversation already exists for this (tenant, jid/telefone) — link it.
      UPDATE public.conversations c
         SET lead_id = r.id
       WHERE c.lead_id IS NULL
         AND ((r.tenant_id IS NULL AND c.tenant_id IS NULL)
              OR (r.tenant_id IS NOT NULL AND c.tenant_id = r.tenant_id))
         AND (c.remote_jid = r.phone || '@s.whatsapp.net' OR c.telefone = r.phone);
    END;
  END LOOP;
  RETURN v_created;
END;
$$;

REVOKE ALL ON FUNCTION public.backfill_whatsapp_lead_conversations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_whatsapp_lead_conversations() TO service_role;
