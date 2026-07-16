ALTER TABLE public.tenant_whatsapp_numbers ALTER COLUMN tenant_id DROP NOT NULL;

-- Policy for tenant admins already scopes by tenant_id; add explicit master policy is unnecessary
-- because "Admin master manages all whatsapp numbers" (has_role admin) covers NULL rows.
