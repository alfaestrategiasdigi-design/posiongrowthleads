
DROP FUNCTION IF EXISTS public.dedupe_whatsapp_import_leads();
CREATE OR REPLACE FUNCTION public.dedupe_whatsapp_import_leads(p_limit integer DEFAULT NULL)
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
        FROM scoped GROUP BY 1,2 HAVING count(*) > 1
    )
    SELECT g.tenant_id, g.norm FROM grp g
     ORDER BY g.tenant_id NULLS FIRST, g.norm
     LIMIT COALESCE(p_limit, 100000)
  LOOP
    SELECT l.id INTO v_keeper
      FROM public.leads l
     WHERE l.origem IN ('whatsapp_import','whatsapp')
       AND ((r.tenant_id IS NULL AND l.tenant_id IS NULL)
            OR (r.tenant_id IS NOT NULL AND l.tenant_id = r.tenant_id))
       AND public.normalize_phone(l.whatsapp) = r.norm
     ORDER BY
       EXISTS (SELECT 1 FROM public.conversations c WHERE c.lead_id = l.id) DESC,
       l.created_at ASC, l.id ASC
     LIMIT 1;
    IF v_keeper IS NULL THEN CONTINUE; END IF;

    SELECT array_agg(l.id) INTO v_losers
      FROM public.leads l
     WHERE l.origem IN ('whatsapp_import','whatsapp')
       AND ((r.tenant_id IS NULL AND l.tenant_id IS NULL)
            OR (r.tenant_id IS NOT NULL AND l.tenant_id = r.tenant_id))
       AND public.normalize_phone(l.whatsapp) = r.norm
       AND l.id <> v_keeper;
    IF v_losers IS NULL OR array_length(v_losers, 1) IS NULL THEN CONTINUE; END IF;

    UPDATE public.conversations       SET lead_id = v_keeper WHERE lead_id = ANY(v_losers);
    UPDATE public.appointments        SET lead_id = v_keeper WHERE lead_id = ANY(v_losers);
    UPDATE public.lead_tasks          SET lead_id = v_keeper WHERE lead_id = ANY(v_losers);
    UPDATE public.campaign_lead_links SET lead_id = v_keeper WHERE lead_id = ANY(v_losers);

    UPDATE public.agency_leads a SET source_lead_id = v_keeper
      WHERE a.source_lead_id = ANY(v_losers)
        AND NOT EXISTS (SELECT 1 FROM public.agency_leads a2 WHERE a2.source_lead_id = v_keeper);
    UPDATE public.patients p SET source_form_lead_id = v_keeper
      WHERE p.source_form_lead_id = ANY(v_losers)
        AND NOT EXISTS (SELECT 1 FROM public.patients p2 WHERE p2.source_form_lead_id = v_keeper);

    UPDATE public.sales                   SET lead_id = v_keeper WHERE lead_id = ANY(v_losers);
    UPDATE public.lead_status_events      SET lead_id = v_keeper WHERE lead_id = ANY(v_losers);
    UPDATE public.medical_records         SET lead_id = v_keeper WHERE lead_id = ANY(v_losers);
    UPDATE public.automation_executions   SET lead_id = v_keeper WHERE lead_id = ANY(v_losers);
    UPDATE public.automation_tasks        SET lead_id = v_keeper WHERE lead_id = ANY(v_losers);
    UPDATE public.recall_executions       SET lead_id = v_keeper WHERE lead_id = ANY(v_losers);
    UPDATE public.capi_events_sent        SET lead_id = v_keeper WHERE lead_id = ANY(v_losers);
    UPDATE public.facebook_capi_logs      SET lead_id = v_keeper WHERE lead_id = ANY(v_losers);
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

REVOKE ALL ON FUNCTION public.dedupe_whatsapp_import_leads(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dedupe_whatsapp_import_leads(integer) TO service_role;
