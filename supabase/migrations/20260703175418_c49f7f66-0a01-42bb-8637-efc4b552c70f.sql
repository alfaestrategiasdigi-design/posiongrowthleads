
-- ============ automation_flows ============
CREATE TABLE public.automation_flows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  is_admin_master BOOLEAN NOT NULL DEFAULT false,
  name TEXT NOT NULL,
  description TEXT,
  trigger_type TEXT NOT NULL,
  trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  nodes JSONB NOT NULL DEFAULT '[]'::jsonb,
  edges JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status IN ('draft','active','paused'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.automation_flows TO authenticated;
GRANT ALL ON public.automation_flows TO service_role;
ALTER TABLE public.automation_flows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "flows admin master full" ON public.automation_flows
  FOR ALL USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "flows tenant read" ON public.automation_flows
  FOR SELECT USING (
    tenant_id IS NOT NULL AND public.has_tenant_access(auth.uid(), tenant_id)
  );

CREATE POLICY "flows tenant write" ON public.automation_flows
  FOR ALL USING (
    tenant_id IS NOT NULL AND public.is_tenant_admin(auth.uid(), tenant_id)
  ) WITH CHECK (
    tenant_id IS NOT NULL AND public.is_tenant_admin(auth.uid(), tenant_id)
  );

CREATE INDEX idx_flows_tenant ON public.automation_flows(tenant_id);
CREATE INDEX idx_flows_status ON public.automation_flows(status);

-- ============ automation_executions ============
CREATE TABLE public.automation_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  is_admin_master BOOLEAN NOT NULL DEFAULT false,
  flow_id UUID NOT NULL REFERENCES public.automation_flows(id) ON DELETE CASCADE,
  lead_id UUID,
  agency_lead_id UUID,
  contact_phone TEXT,
  contact_name TEXT,
  current_node TEXT,
  variables JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'running',
  wait_until TIMESTAMPTZ,
  last_error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status IN ('running','waiting','completed','failed','cancelled'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.automation_executions TO authenticated;
GRANT ALL ON public.automation_executions TO service_role;
ALTER TABLE public.automation_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "exec admin master full" ON public.automation_executions
  FOR ALL USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "exec tenant read" ON public.automation_executions
  FOR SELECT USING (
    tenant_id IS NOT NULL AND public.has_tenant_access(auth.uid(), tenant_id)
  );

CREATE INDEX idx_exec_flow ON public.automation_executions(flow_id);
CREATE INDEX idx_exec_tenant ON public.automation_executions(tenant_id);
CREATE INDEX idx_exec_status ON public.automation_executions(status);
CREATE INDEX idx_exec_wait ON public.automation_executions(wait_until) WHERE status = 'waiting';

-- ============ automation_tasks ============
CREATE TABLE public.automation_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  is_admin_master BOOLEAN NOT NULL DEFAULT false,
  lead_id UUID,
  agency_lead_id UUID,
  contact_name TEXT,
  contact_phone TEXT NOT NULL,
  message_content TEXT NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'pending',
  requires_approval BOOLEAN NOT NULL DEFAULT false,
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  sent_at TIMESTAMPTZ,
  send_error TEXT,
  flow_execution_id UUID REFERENCES public.automation_executions(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status IN ('pending','approved','sent','cancelled','failed'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.automation_tasks TO authenticated;
GRANT ALL ON public.automation_tasks TO service_role;
ALTER TABLE public.automation_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tasks admin master full" ON public.automation_tasks
  FOR ALL USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "tasks tenant read" ON public.automation_tasks
  FOR SELECT USING (
    tenant_id IS NOT NULL AND public.has_tenant_access(auth.uid(), tenant_id)
  );

CREATE POLICY "tasks tenant write" ON public.automation_tasks
  FOR ALL USING (
    tenant_id IS NOT NULL AND public.has_tenant_access(auth.uid(), tenant_id)
  ) WITH CHECK (
    tenant_id IS NOT NULL AND public.has_tenant_access(auth.uid(), tenant_id)
  );

CREATE INDEX idx_tasks_tenant ON public.automation_tasks(tenant_id);
CREATE INDEX idx_tasks_status ON public.automation_tasks(status);
CREATE INDEX idx_tasks_scheduled ON public.automation_tasks(scheduled_for) WHERE status IN ('pending','approved');

-- ============ automation_templates ============
CREATE TABLE public.automation_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  is_global BOOLEAN NOT NULL DEFAULT false,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  trigger_type TEXT NOT NULL,
  trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  nodes JSONB NOT NULL DEFAULT '[]'::jsonb,
  edges JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (category IN ('agencia','clinica'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.automation_templates TO authenticated;
GRANT ALL ON public.automation_templates TO service_role;
ALTER TABLE public.automation_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tpl read global or own" ON public.automation_templates
  FOR SELECT USING (
    is_global = true
    OR public.has_role(auth.uid(), 'admin')
    OR (tenant_id IS NOT NULL AND public.has_tenant_access(auth.uid(), tenant_id))
  );

CREATE POLICY "tpl admin master write" ON public.automation_templates
  FOR ALL USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "tpl tenant write own" ON public.automation_templates
  FOR ALL USING (
    tenant_id IS NOT NULL AND public.is_tenant_admin(auth.uid(), tenant_id)
  ) WITH CHECK (
    tenant_id IS NOT NULL AND public.is_tenant_admin(auth.uid(), tenant_id)
  );

CREATE INDEX idx_tpl_category ON public.automation_templates(category);

-- Updated_at triggers
CREATE TRIGGER trg_flows_updated_at BEFORE UPDATE ON public.automation_flows
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_exec_updated_at BEFORE UPDATE ON public.automation_executions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_tasks_updated_at BEFORE UPDATE ON public.automation_tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_tpl_updated_at BEFORE UPDATE ON public.automation_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ SEED TEMPLATES ============
-- Templates para Agência (Admin Master)
INSERT INTO public.automation_templates (is_global, category, name, description, icon, trigger_type, nodes, edges) VALUES
('true','agencia','Follow-up pós formulário (agência)','Sequência de 3 mensagens após o lead preencher o formulário da agência','🎯','form_submitted',
 '[
   {"id":"t1","type":"trigger","position":{"x":100,"y":100},"data":{"kind":"form_submitted","label":"Formulário preenchido"}},
   {"id":"n1","type":"wait","position":{"x":100,"y":220},"data":{"minutes":5,"label":"Aguardar 5 min"}},
   {"id":"n2","type":"message","position":{"x":100,"y":340},"data":{"text":"Olá {{lead.nome}}! Obrigado por preencher nosso formulário. Em breve nosso comercial entrará em contato 🙌"}},
   {"id":"n3","type":"wait","position":{"x":100,"y":460},"data":{"hours":24,"label":"Aguardar 24h"}},
   {"id":"n4","type":"message","position":{"x":100,"y":580},"data":{"text":"Oi {{lead.nome}}, tudo bem? Passando aqui para saber se podemos agendar uma reunião de 15 min para apresentar nossa solução?"}}
 ]'::jsonb,
 '[{"id":"e1","source":"t1","target":"n1"},{"id":"e2","source":"n1","target":"n2"},{"id":"e3","source":"n2","target":"n3"},{"id":"e4","source":"n3","target":"n4"}]'::jsonb),

('true','agencia','Sequência de reunião agendada','Confirmação, lembrete e follow-up de reunião com clínica','📞','appointment_created',
 '[
   {"id":"t1","type":"trigger","position":{"x":100,"y":100},"data":{"kind":"appointment_created","label":"Reunião agendada"}},
   {"id":"n1","type":"message","position":{"x":100,"y":220},"data":{"text":"Perfeito {{lead.nome}}! Sua reunião está marcada para {{agendamento.data}} às {{agendamento.hora}}. Te envio o link 30 min antes."}},
   {"id":"n2","type":"wait","position":{"x":100,"y":340},"data":{"hours":23,"label":"1 dia antes"}},
   {"id":"n3","type":"buttons","position":{"x":100,"y":460},"data":{"text":"Oi {{lead.nome}}! Amanhã é nossa reunião às {{agendamento.hora}}. Você confirma?","buttons":[{"id":"ok","label":"✅ Confirmar"},{"id":"reag","label":"🔄 Reagendar"}]}}
 ]'::jsonb,
 '[{"id":"e1","source":"t1","target":"n1"},{"id":"e2","source":"n1","target":"n2"},{"id":"e3","source":"n2","target":"n3"}]'::jsonb),

('true','agencia','Nurturing leads frios (7 dias)','Sequência de 3 mensagens em 7 dias para reengajar leads que não responderam','💼','manual',
 '[
   {"id":"t1","type":"trigger","position":{"x":100,"y":100},"data":{"kind":"manual","label":"Início manual"}},
   {"id":"n1","type":"message","position":{"x":100,"y":220},"data":{"text":"Oi {{lead.nome}}, aqui é da POSION! Vi que você tem interesse em crescer a clínica com tráfego pago. Posso te enviar um case?"}},
   {"id":"n2","type":"wait","position":{"x":100,"y":340},"data":{"days":3,"label":"Aguardar 3 dias"}},
   {"id":"n3","type":"message","position":{"x":100,"y":460},"data":{"text":"{{lead.nome}}, montei um material com os resultados de clínicas parceiras. Quer que eu te envie?"}},
   {"id":"n4","type":"wait","position":{"x":100,"y":580},"data":{"days":4,"label":"Aguardar 4 dias"}},
   {"id":"n5","type":"message","position":{"x":100,"y":700},"data":{"text":"Último contato por aqui {{lead.nome}} — se quiser retomar é só responder 🙌"}}
 ]'::jsonb,
 '[{"id":"e1","source":"t1","target":"n1"},{"id":"e2","source":"n1","target":"n2"},{"id":"e3","source":"n2","target":"n3"},{"id":"e4","source":"n3","target":"n4"},{"id":"e5","source":"n4","target":"n5"}]'::jsonb),

('true','agencia','Onboarding pós-venda de clínica','Boas-vindas e próximos passos após fechar contrato','🏆','lead_won',
 '[
   {"id":"t1","type":"trigger","position":{"x":100,"y":100},"data":{"kind":"lead_won","label":"Cliente fechou"}},
   {"id":"n1","type":"message","position":{"x":100,"y":220},"data":{"text":"🎉 {{lead.nome}}, seja bem-vindo(a) à POSION! Estou muito feliz em ter vocês com a gente."}},
   {"id":"n2","type":"wait","position":{"x":100,"y":340},"data":{"hours":2,"label":"Aguardar 2h"}},
   {"id":"n3","type":"message","position":{"x":100,"y":460},"data":{"text":"Já criei sua conta no sistema. Em breve te envio o link e as credenciais para começarmos 🚀"}}
 ]'::jsonb,
 '[{"id":"e1","source":"t1","target":"n1"},{"id":"e2","source":"n1","target":"n2"},{"id":"e3","source":"n2","target":"n3"}]'::jsonb),

('true','agencia','Reativação de leads perdidos','Mensagem para trazer de volta leads que foram marcados como perdidos','🔄','manual',
 '[
   {"id":"t1","type":"trigger","position":{"x":100,"y":100},"data":{"kind":"manual","label":"Início manual"}},
   {"id":"n1","type":"message","position":{"x":100,"y":220},"data":{"text":"Oi {{lead.nome}}, faz um tempo que não conversamos! Muita coisa evoluiu por aqui. Posso te contar as novidades?"}}
 ]'::jsonb,
 '[{"id":"e1","source":"t1","target":"n1"}]'::jsonb);

-- Templates para Clínicas
INSERT INTO public.automation_templates (is_global, category, name, description, icon, trigger_type, nodes, edges) VALUES
('true','clinica','Confirmação pós agendamento','Confirma o agendamento e envia detalhes ao paciente','📅','appointment_created',
 '[
   {"id":"t1","type":"trigger","position":{"x":100,"y":100},"data":{"kind":"appointment_created","label":"Agendamento criado"}},
   {"id":"n1","type":"wait","position":{"x":100,"y":220},"data":{"minutes":5,"label":"Aguardar 5 min"}},
   {"id":"n2","type":"message","position":{"x":100,"y":340},"data":{"text":"Olá {{lead.nome}}! 😊 Sua consulta na {{clinica.nome}} foi agendada para {{agendamento.data}} às {{agendamento.hora}}. Qualquer dúvida estamos aqui!"}}
 ]'::jsonb,
 '[{"id":"e1","source":"t1","target":"n1"},{"id":"e2","source":"n1","target":"n2"}]'::jsonb),

('true','clinica','Lembrete 24h antes da consulta','Lembrete com botões de confirmação/cancelamento','⏰','appointment_created',
 '[
   {"id":"t1","type":"trigger","position":{"x":100,"y":100},"data":{"kind":"appointment_created","label":"Agendamento criado"}},
   {"id":"n1","type":"wait","position":{"x":100,"y":220},"data":{"beforeAppointmentHours":24,"label":"24h antes da consulta"}},
   {"id":"n2","type":"buttons","position":{"x":100,"y":340},"data":{"text":"Oi {{lead.nome}}! Lembrete: sua consulta é AMANHÃ às {{agendamento.hora}}. Você confirma sua presença?","buttons":[{"id":"ok","label":"✅ Confirmar"},{"id":"cancel","label":"❌ Cancelar"},{"id":"reag","label":"🔄 Reagendar"}]}}
 ]'::jsonb,
 '[{"id":"e1","source":"t1","target":"n1"},{"id":"e2","source":"n1","target":"n2"}]'::jsonb),

('true','clinica','Lembrete 2h antes','Aviso curto próximo do horário','⏰','appointment_created',
 '[
   {"id":"t1","type":"trigger","position":{"x":100,"y":100},"data":{"kind":"appointment_created","label":"Agendamento criado"}},
   {"id":"n1","type":"wait","position":{"x":100,"y":220},"data":{"beforeAppointmentHours":2,"label":"2h antes"}},
   {"id":"n2","type":"message","position":{"x":100,"y":340},"data":{"text":"{{lead.nome}}, sua consulta é hoje às {{agendamento.hora}}! Te esperamos 🙏"}}
 ]'::jsonb,
 '[{"id":"e1","source":"t1","target":"n1"},{"id":"e2","source":"n1","target":"n2"}]'::jsonb),

('true','clinica','Pós-consulta: pesquisa de satisfação','Feedback após atendimento','✅','appointment_confirmed',
 '[
   {"id":"t1","type":"trigger","position":{"x":100,"y":100},"data":{"kind":"appointment_confirmed","label":"Consulta realizada"}},
   {"id":"n1","type":"wait","position":{"x":100,"y":220},"data":{"hours":3,"label":"Aguardar 3h"}},
   {"id":"n2","type":"buttons","position":{"x":100,"y":340},"data":{"text":"Oi {{lead.nome}}! Como foi seu atendimento hoje na {{clinica.nome}}?","buttons":[{"id":"5","label":"⭐⭐⭐⭐⭐"},{"id":"3","label":"⭐⭐⭐"},{"id":"1","label":"⭐"}]}}
 ]'::jsonb,
 '[{"id":"e1","source":"t1","target":"n1"},{"id":"e2","source":"n1","target":"n2"}]'::jsonb),

('true','clinica','Nurturing lead não fechado','Sequência de 3 mensagens em 7 dias para lead que não converteu','💰','manual',
 '[
   {"id":"t1","type":"trigger","position":{"x":100,"y":100},"data":{"kind":"manual","label":"Início manual"}},
   {"id":"n1","type":"message","position":{"x":100,"y":220},"data":{"text":"Oi {{lead.nome}}, aqui é da {{clinica.nome}}. Ainda tem interesse no procedimento?"}},
   {"id":"n2","type":"wait","position":{"x":100,"y":340},"data":{"days":3,"label":"Aguardar 3 dias"}},
   {"id":"n3","type":"message","position":{"x":100,"y":460},"data":{"text":"Temos uma condição especial esta semana. Posso te enviar?"}},
   {"id":"n4","type":"wait","position":{"x":100,"y":580},"data":{"days":4,"label":"Aguardar 4 dias"}},
   {"id":"n5","type":"message","position":{"x":100,"y":700},"data":{"text":"Última chance dessa condição {{lead.nome}} — se quiser reservar é só responder 🙌"}}
 ]'::jsonb,
 '[{"id":"e1","source":"t1","target":"n1"},{"id":"e2","source":"n1","target":"n2"},{"id":"e3","source":"n2","target":"n3"},{"id":"e4","source":"n3","target":"n4"},{"id":"e5","source":"n4","target":"n5"}]'::jsonb),

('true','clinica','Recall paciente sem retorno','Recall em 30/60/90 dias','🔄','manual',
 '[
   {"id":"t1","type":"trigger","position":{"x":100,"y":100},"data":{"kind":"manual","label":"Início manual"}},
   {"id":"n1","type":"message","position":{"x":100,"y":220},"data":{"text":"Oi {{lead.nome}}! Faz um tempo que você não nos visita. Que tal agendar um retorno?"}}
 ]'::jsonb,
 '[{"id":"e1","source":"t1","target":"n1"}]'::jsonb),

('true','clinica','Mensagem de aniversário','Parabéns automático no dia do aniversário','🎂','birthday',
 '[
   {"id":"t1","type":"trigger","position":{"x":100,"y":100},"data":{"kind":"birthday","label":"Aniversário do paciente"}},
   {"id":"n1","type":"message","position":{"x":100,"y":220},"data":{"text":"🎂 Feliz aniversário {{lead.nome}}! A equipe da {{clinica.nome}} deseja um dia incrível 🎉"}}
 ]'::jsonb,
 '[{"id":"e1","source":"t1","target":"n1"}]'::jsonb);
