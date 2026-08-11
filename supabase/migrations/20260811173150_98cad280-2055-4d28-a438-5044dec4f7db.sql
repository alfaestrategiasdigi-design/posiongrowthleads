WITH sent_phones AS (
  SELECT DISTINCT
    c.tenant_id,
    right(regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g'), 8) AS tail,
    max(m.created_at) AS last_sent
  FROM public.messages m
  JOIN public.conversations c ON c.id = m.conversation_id
  WHERE m.tipo_disparo = 'boas_vindas'
    AND m.created_at > now() - interval '30 days'
    AND coalesce(c.telefone, '') <> ''
  GROUP BY 1, 2
)
UPDATE public.leads l
SET welcome_sent_at = sp.last_sent
FROM sent_phones sp
WHERE l.welcome_sent_at IS NULL
  AND length(sp.tail) = 8
  AND right(regexp_replace(coalesce(l.whatsapp, ''), '\D', '', 'g'), 8) = sp.tail
  AND (l.tenant_id IS NOT DISTINCT FROM sp.tenant_id);