// Shim retrocompatível — o modal foi substituído pelo UnifiedLeadPanel.
import UnifiedLeadPanel from "@/components/leads/UnifiedLeadPanel";
import type { Lead } from "@/types/admin";

interface LeadDetailModalProps {
  lead: Lead | null;
  open: boolean;
  onClose: () => void;
  onUpdated?: () => void;
}

const LeadDetailModal = ({ lead, open, onClose, onUpdated }: LeadDetailModalProps) => (
  <UnifiedLeadPanel
    source={lead ? "lead" : null}
    leadId={lead?.id ?? null}
    open={open}
    onClose={onClose}
    onUpdated={onUpdated}
  />
);

export default LeadDetailModal;
