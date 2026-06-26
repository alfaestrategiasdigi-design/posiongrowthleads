DO $$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT id INTO v_tenant_id
  FROM public.tenants
  WHERE slug = 'alessandrocapilar'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant alessandrocapilar não encontrado';
  END IF;

  UPDATE public.conversations
  SET tenant_id = v_tenant_id
  WHERE tenant_id IS NULL
    AND provider = 'evolution';

  UPDATE public.messages m
  SET tenant_id = v_tenant_id
  FROM public.conversations c
  WHERE m.conversation_id = c.id
    AND c.tenant_id = v_tenant_id
    AND m.tenant_id IS NULL;
END $$;