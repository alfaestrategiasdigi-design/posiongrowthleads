
-- 1) leads.owner_user_id (responsável comercial pelo lead)
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_leads_owner_user_id ON public.leads(owner_user_id);

-- 2) sales.lead_id + backfill a partir de metadata->>'lead_id'
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS lead_id uuid;
CREATE INDEX IF NOT EXISTS idx_sales_lead_id ON public.sales(lead_id);

UPDATE public.sales s
   SET lead_id = (s.metadata->>'lead_id')::uuid
 WHERE s.lead_id IS NULL
   AND s.metadata ? 'lead_id'
   AND (s.metadata->>'lead_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- Atualiza trigger existente para gravar em sales.lead_id também (mantém metadata p/ compat)
CREATE OR REPLACE FUNCTION public.trg_create_sale_on_lead_ganho()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'ganho'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'ganho')
     AND NEW.tenant_id IS NOT NULL
  THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.sales
      WHERE tenant_id = NEW.tenant_id
        AND (lead_id = NEW.id OR metadata->>'lead_id' = NEW.id::text)
    ) THEN
      INSERT INTO public.sales (
        tenant_id, lead_id, patient_name, seller_name, product, category, channel,
        amount, amount_paid, sale_date, first_contact_date, international,
        notes, channel_origin, facebook_campaign_id, utm_source, utm_campaign, metadata
      ) VALUES (
        NEW.tenant_id,
        NEW.id,
        COALESCE(NEW.nome_completo, 'Lead'),
        NULL,
        COALESCE(NEW.especialidade, NEW.facebook_form_name),
        NULL,
        COALESCE(NEW.origem, 'kanban'),
        COALESCE(NEW.valor_proposta, 0),
        0,
        COALESCE(NEW.fechado_em::date, CURRENT_DATE),
        NULL,
        false,
        NEW.observacoes,
        NEW.origem,
        NEW.facebook_campaign,
        NEW.utm_source,
        NEW.utm_campaign,
        jsonb_build_object('lead_id', NEW.id, 'source', 'lead_kanban_ganho')
      );
    END IF;
  END IF;
  RETURN NEW;
END; $function$;

-- 3) lead_status_events + trigger de auditoria
CREATE TABLE IF NOT EXISTS public.lead_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL,
  from_status text,
  to_status text NOT NULL,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','automation','webhook','trigger','import')),
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lse_lead_id ON public.lead_status_events(lead_id, changed_at DESC);

GRANT SELECT, INSERT ON public.lead_status_events TO authenticated;
GRANT ALL ON public.lead_status_events TO service_role;

ALTER TABLE public.lead_status_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin ve todo historico" ON public.lead_status_events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Tenant ve historico do proprio lead" ON public.lead_status_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = lead_status_events.lead_id
        AND l.tenant_id IS NOT NULL
        AND public.has_tenant_access(auth.uid(), l.tenant_id)
    )
  );

CREATE POLICY "Service role escreve" ON public.lead_status_events
  FOR INSERT TO service_role WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.trg_log_lead_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.lead_status_events(lead_id, from_status, to_status, changed_by, source)
    VALUES (NEW.id, NULL, NEW.status, auth.uid(), CASE WHEN auth.uid() IS NULL THEN 'automation' ELSE 'manual' END);
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.lead_status_events(lead_id, from_status, to_status, changed_by, source)
    VALUES (NEW.id, OLD.status, NEW.status, auth.uid(), CASE WHEN auth.uid() IS NULL THEN 'automation' ELSE 'manual' END);
  END IF;
  RETURN NEW;
END; $function$;

DROP TRIGGER IF EXISTS trg_leads_status_audit ON public.leads;
CREATE TRIGGER trg_leads_status_audit
  AFTER INSERT OR UPDATE OF status ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.trg_log_lead_status_change();

-- 4) CHECK constraint em leads.status (todos valores atuais já batem com o enum canônico)
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_status_check;
ALTER TABLE public.leads
  ADD CONSTRAINT leads_status_check
  CHECK (status IN ('lead','qualificado','reuniao_agendada','compareceu','negociacao','ganho','perdido','no_show'));

-- 5) leads.valor_perdido
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS valor_perdido numeric;
