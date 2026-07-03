
-- 1. Normalizador de telefone (últimos 11 dígitos, sem DDI)
CREATE OR REPLACE FUNCTION public.normalize_phone(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p IS NULL THEN NULL
    ELSE right(regexp_replace(p, '\D', '', 'g'), 11)
  END;
$$;

-- 2. Índices funcionais para casar telefones rapidamente
CREATE INDEX IF NOT EXISTS idx_leads_phone_norm
  ON public.leads (public.normalize_phone(whatsapp))
  WHERE whatsapp IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_phone_norm
  ON public.conversations (public.normalize_phone(telefone))
  WHERE telefone IS NOT NULL;

-- 3. Trigger em conversations: quando criar/atualizar telefone no MASTER (tenant_id IS NULL),
-- localizar lead master (tenant_id IS NULL) com telefone normalizado igual.
CREATE OR REPLACE FUNCTION public.trg_link_conversation_to_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone text;
  v_lead_id uuid;
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  v_phone := public.normalize_phone(NEW.telefone);
  IF v_phone IS NULL OR length(v_phone) < 8 THEN
    RETURN NEW;
  END IF;
  IF NEW.tenant_id IS NULL THEN
    SELECT id INTO v_lead_id FROM public.leads
     WHERE tenant_id IS NULL
       AND public.normalize_phone(whatsapp) = v_phone
     ORDER BY created_at DESC
     LIMIT 1;
  ELSE
    SELECT id INTO v_lead_id FROM public.leads
     WHERE tenant_id = NEW.tenant_id
       AND public.normalize_phone(whatsapp) = v_phone
     ORDER BY created_at DESC
     LIMIT 1;
  END IF;
  IF v_lead_id IS NOT NULL THEN
    NEW.lead_id := v_lead_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS conversations_link_lead ON public.conversations;
CREATE TRIGGER conversations_link_lead
BEFORE INSERT OR UPDATE OF telefone, tenant_id ON public.conversations
FOR EACH ROW EXECUTE FUNCTION public.trg_link_conversation_to_lead();

-- 4. Trigger em leads: ao inserir/atualizar telefone de lead, vincular conversas órfãs
CREATE OR REPLACE FUNCTION public.trg_link_lead_to_conversations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone text;
BEGIN
  v_phone := public.normalize_phone(NEW.whatsapp);
  IF v_phone IS NULL OR length(v_phone) < 8 THEN
    RETURN NEW;
  END IF;
  UPDATE public.conversations c
     SET lead_id = NEW.id
   WHERE c.lead_id IS NULL
     AND public.normalize_phone(c.telefone) = v_phone
     AND (
       (NEW.tenant_id IS NULL AND c.tenant_id IS NULL) OR
       (NEW.tenant_id IS NOT NULL AND c.tenant_id = NEW.tenant_id)
     );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leads_link_conversations ON public.leads;
CREATE TRIGGER leads_link_conversations
AFTER INSERT OR UPDATE OF whatsapp, tenant_id ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.trg_link_lead_to_conversations();

-- 5. Backfill imediato: casa conversas órfãs com leads existentes por telefone normalizado (mesmo escopo de tenant)
UPDATE public.conversations c
   SET lead_id = l.id
  FROM public.leads l
 WHERE c.lead_id IS NULL
   AND l.whatsapp IS NOT NULL
   AND c.telefone IS NOT NULL
   AND public.normalize_phone(c.telefone) = public.normalize_phone(l.whatsapp)
   AND length(public.normalize_phone(c.telefone)) >= 8
   AND (
     (c.tenant_id IS NULL AND l.tenant_id IS NULL) OR
     (c.tenant_id IS NOT NULL AND c.tenant_id = l.tenant_id)
   );
