
INSERT INTO public.tenant_ad_accounts (tenant_id, ad_account_id, label, active)
SELECT DISTINCT r.tenant_id,
       CASE WHEN r.match_value LIKE 'act_%' THEN r.match_value ELSE 'act_' || r.match_value END,
       COALESCE(r.match_label, r.match_value),
       true
FROM public.lead_routing_rules r
WHERE r.active = true
  AND r.match_type = 'ad_account_id'
  AND r.tenant_id IS NOT NULL
ON CONFLICT (tenant_id, ad_account_id) DO NOTHING;
