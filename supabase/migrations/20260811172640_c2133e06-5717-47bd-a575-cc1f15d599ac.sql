ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS welcome_sent_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_leads_welcome_phone
  ON public.leads (tenant_id, welcome_sent_at);

-- Marca leads que já receberam boas-vindas (últimos 30 dias) para não reenviar
UPDATE public.leads l
SET welcome_sent_at = m.created_at
FROM (
  SELECT c.lead_id, min(msg.created_at) AS created_at
  FROM public.messages msg
  JOIN public.conversations c ON c.id = msg.conversation_id
  WHERE msg.tipo_disparo = 'boas_vindas'
    AND msg.created_at > now() - interval '30 days'
    AND c.lead_id IS NOT NULL
  GROUP BY c.lead_id
) m
WHERE l.id = m.lead_id AND l.welcome_sent_at IS NULL;