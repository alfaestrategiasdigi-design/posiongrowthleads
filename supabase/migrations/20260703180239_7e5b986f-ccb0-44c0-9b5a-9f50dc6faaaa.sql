
INSERT INTO public.tenants (id, slug, name, plan, status)
VALUES ('00000000-0000-0000-0000-000000000001', 'admin-master', 'Conta Admin (Master)', 'enterprise', 'active')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.tenant_users (user_id, tenant_id, role, active)
SELECT ur.user_id, '00000000-0000-0000-0000-000000000001'::uuid,
       (CASE WHEN ur.role::text = 'admin' THEN 'owner' ELSE 'admin' END)::tenant_role,
       true
FROM public.user_roles ur
WHERE ur.role::text IN ('admin','comercial_admin_master')
ON CONFLICT (user_id, tenant_id) DO UPDATE
SET active = true,
    role = EXCLUDED.role;
