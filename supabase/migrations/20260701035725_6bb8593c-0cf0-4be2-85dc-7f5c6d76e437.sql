INSERT INTO public.agency_leads (
  id, nome_clinica, responsavel, whatsapp, email, cidade, estado, origem, stage,
  valor_proposta, notas, created_at, updated_at
)
SELECT
  l.id,
  COALESCE(NULLIF(l.nome_empresa,''), NULLIF(l.nome_completo,''), 'Sem nome'),
  l.nome_completo,
  l.whatsapp,
  l.email,
  split_part(COALESCE(l.cidade_estado,''), '/', 1),
  NULLIF(split_part(COALESCE(l.cidade_estado,''), '/', 2), ''),
  COALESCE(l.origem, 'formulario'),
  CASE
    WHEN l.status = 'reuniao_agendada' THEN 'reuniao'
    WHEN l.status IN ('compareceu','no_show') THEN 'reuniao'
    WHEN l.status IN ('lead','qualificado','negociacao','ganho','perdido') THEN l.status
    ELSE 'lead'
  END,
  COALESCE(l.valor_proposta, 0),
  l.observacoes,
  l.created_at,
  now()
FROM public.leads l
WHERE NOT EXISTS (SELECT 1 FROM public.agency_leads a WHERE a.id = l.id);