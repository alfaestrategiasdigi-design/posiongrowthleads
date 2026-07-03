import AutomationsPage from "@/pages/AutomationsPage";

export default function AdminAutomationsPage() {
  return <AutomationsPage scope={{ tenantId: null, isAdminMaster: true }} />;
}
