
DROP POLICY IF EXISTS "Agency members manage master zapi" ON public.zapi_connections;
CREATE POLICY "Agency members manage master zapi" ON public.zapi_connections
  FOR ALL TO authenticated
  USING (tenant_id IS NULL AND public.is_agency_member(auth.uid()))
  WITH CHECK (tenant_id IS NULL AND public.is_agency_member(auth.uid()));

DROP POLICY IF EXISTS "Agency members manage master conversations" ON public.conversations;
CREATE POLICY "Agency members manage master conversations" ON public.conversations
  FOR ALL TO authenticated
  USING (tenant_id IS NULL AND public.is_agency_member(auth.uid()))
  WITH CHECK (tenant_id IS NULL AND public.is_agency_member(auth.uid()));

DROP POLICY IF EXISTS "Agency members manage master messages" ON public.messages;
CREATE POLICY "Agency members manage master messages" ON public.messages
  FOR ALL TO authenticated
  USING (tenant_id IS NULL AND public.is_agency_member(auth.uid()))
  WITH CHECK (tenant_id IS NULL AND public.is_agency_member(auth.uid()));

DROP POLICY IF EXISTS "Agency members manage master welcome" ON public.whatsapp_welcome_config;
CREATE POLICY "Agency members manage master welcome" ON public.whatsapp_welcome_config
  FOR ALL TO authenticated
  USING (tenant_id IS NULL AND public.is_agency_member(auth.uid()))
  WITH CHECK (tenant_id IS NULL AND public.is_agency_member(auth.uid()));

DROP POLICY IF EXISTS "Agency members manage master tags" ON public.conversation_tags;
CREATE POLICY "Agency members manage master tags" ON public.conversation_tags
  FOR ALL TO authenticated
  USING (tenant_id IS NULL AND public.is_agency_member(auth.uid()))
  WITH CHECK (tenant_id IS NULL AND public.is_agency_member(auth.uid()));

DROP POLICY IF EXISTS "Agency members read master reactions" ON public.message_reactions;
CREATE POLICY "Agency members read master reactions" ON public.message_reactions
  FOR SELECT TO authenticated
  USING (tenant_id IS NULL AND public.is_agency_member(auth.uid()));

DROP POLICY IF EXISTS "Agency members delete master reactions" ON public.message_reactions;
CREATE POLICY "Agency members delete master reactions" ON public.message_reactions
  FOR DELETE TO authenticated
  USING (tenant_id IS NULL AND public.is_agency_member(auth.uid()));
