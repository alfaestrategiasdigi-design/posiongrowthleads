
UPDATE public.leads
   SET tenant_id = NULL
 WHERE tenant_id = 'bb96152a-ce55-4728-94e1-dc6e44356889'
   AND facebook_form_id = '1858043458199562';

DELETE FROM public.lead_routing_rules
 WHERE id = 'ea0c367b-a0cb-4f6c-834f-1e8d5cf2134a';
