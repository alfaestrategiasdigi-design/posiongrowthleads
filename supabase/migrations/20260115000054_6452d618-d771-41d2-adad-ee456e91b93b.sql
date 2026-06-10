-- Add status column to leads table for Kanban management
ALTER TABLE public.leads 
ADD COLUMN status TEXT NOT NULL DEFAULT 'novo';

-- Add index for better performance when filtering by status
CREATE INDEX idx_leads_status ON public.leads(status);

-- Update RLS policy for admins to update leads
CREATE POLICY "Admins can update leads" 
ON public.leads 
FOR UPDATE 
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));