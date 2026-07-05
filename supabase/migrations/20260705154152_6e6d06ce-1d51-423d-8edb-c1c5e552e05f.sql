ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS needs_lid_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lid_review_notes text;
CREATE INDEX IF NOT EXISTS idx_conversations_needs_lid_review
  ON public.conversations (tenant_id, needs_lid_review)
  WHERE needs_lid_review = true;