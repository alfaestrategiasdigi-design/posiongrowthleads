
-- 1) Enums
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'comercial_admin_master';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'admin_tenant';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'comercial_tenant';
ALTER TYPE public.tenant_role ADD VALUE IF NOT EXISTS 'comercial_tenant';
