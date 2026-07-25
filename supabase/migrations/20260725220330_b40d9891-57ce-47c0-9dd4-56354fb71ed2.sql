ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_status_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_status_check CHECK (
  status = ANY (ARRAY[
    'lead','qualificado','agendar_reuniao','reuniao_agendada','compareceu',
    'proposta','negociacao','ganho','ativo','perdido','no_show'
  ])
);