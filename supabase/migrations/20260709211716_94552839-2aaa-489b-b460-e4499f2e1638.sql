
-- Seed "Boas-vindas após formulário" automation for every tenant + auto-create for new tenants

DO $$
DECLARE
  t_id uuid;
  trig_id text;
  msg_id text;
  v_nodes jsonb;
  v_edges jsonb;
BEGIN
  FOR t_id IN SELECT id FROM public.tenants LOOP
    -- skip if this tenant already has the seeded flow
    IF EXISTS (
      SELECT 1 FROM public.automation_flows
      WHERE tenant_id = t_id
        AND trigger_config->>'key' = 'auto_form_greeting'
    ) THEN
      CONTINUE;
    END IF;

    trig_id := substr(replace(gen_random_uuid()::text,'-',''),1,8);
    msg_id  := substr(replace(gen_random_uuid()::text,'-',''),1,8);

    v_nodes := jsonb_build_array(
      jsonb_build_object(
        'id', trig_id,
        'type','trigger',
        'position', jsonb_build_object('x',80,'y',120),
        'data', jsonb_build_object('label','Formulário preenchido')
      ),
      jsonb_build_object(
        'id', msg_id,
        'type','message',
        'position', jsonb_build_object('x',380,'y',120),
        'data', jsonb_build_object(
          'label','Enviar texto',
          'text','Olá {{lead.nome}}! 👋 Recebemos seu contato e nossa equipe já foi notificada. Em instantes um especialista vai falar com você por aqui. Obrigado pelo interesse!'
        )
      )
    );

    v_edges := jsonb_build_array(
      jsonb_build_object(
        'id', substr(replace(gen_random_uuid()::text,'-',''),1,8),
        'source', trig_id,
        'target', msg_id
      )
    );

    INSERT INTO public.automation_flows (
      tenant_id, is_admin_master, name, description,
      trigger_type, trigger_config, nodes, edges, status
    ) VALUES (
      t_id, false,
      'Boas-vindas após formulário',
      'Mensagem automática enviada quando um lead preenche o formulário avisando que a equipe entrará em contato.',
      'form_submitted',
      jsonb_build_object('form_name','','key','auto_form_greeting'),
      v_nodes, v_edges, 'active'
    );
  END LOOP;
END $$;

-- Function + trigger to auto-seed for new tenants
CREATE OR REPLACE FUNCTION public.trg_seed_form_greeting_flow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  trig_id text := substr(replace(gen_random_uuid()::text,'-',''),1,8);
  msg_id  text := substr(replace(gen_random_uuid()::text,'-',''),1,8);
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.automation_flows
    WHERE tenant_id = NEW.id
      AND trigger_config->>'key' = 'auto_form_greeting'
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.automation_flows (
    tenant_id, is_admin_master, name, description,
    trigger_type, trigger_config, nodes, edges, status
  ) VALUES (
    NEW.id, false,
    'Boas-vindas após formulário',
    'Mensagem automática enviada quando um lead preenche o formulário avisando que a equipe entrará em contato.',
    'form_submitted',
    jsonb_build_object('form_name','','key','auto_form_greeting'),
    jsonb_build_array(
      jsonb_build_object('id',trig_id,'type','trigger',
        'position', jsonb_build_object('x',80,'y',120),
        'data', jsonb_build_object('label','Formulário preenchido')),
      jsonb_build_object('id',msg_id,'type','message',
        'position', jsonb_build_object('x',380,'y',120),
        'data', jsonb_build_object('label','Enviar texto',
          'text','Olá {{lead.nome}}! 👋 Recebemos seu contato e nossa equipe já foi notificada. Em instantes um especialista vai falar com você por aqui. Obrigado pelo interesse!'))
    ),
    jsonb_build_array(
      jsonb_build_object('id', substr(replace(gen_random_uuid()::text,'-',''),1,8),
        'source', trig_id, 'target', msg_id)
    ),
    'active'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS seed_form_greeting_flow ON public.tenants;
CREATE TRIGGER seed_form_greeting_flow
AFTER INSERT ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.trg_seed_form_greeting_flow();
