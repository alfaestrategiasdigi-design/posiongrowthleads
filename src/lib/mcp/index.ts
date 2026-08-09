import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listTenants from "./tools/list-tenants";
import listLeads from "./tools/list-leads";
import getLead from "./tools/get-lead";
import createLead from "./tools/create-lead";
import updateLeadStatus from "./tools/update-lead-status";
import listPipelineStages from "./tools/list-pipeline-stages";
import listAppointments from "./tools/list-appointments";
import listTasks from "./tools/list-tasks";
import createTask from "./tools/create-task";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "posion-growth-leadds",
  title: "posion growth leadds",
  version: "0.1.0",
  instructions:
    "Ferramentas do CRM POSION Tools. Comece por list_tenants para descobrir o slug do cliente, depois use list_leads, get_lead, list_pipeline_stages, list_appointments e list_tasks para consultar, e create_lead, update_lead_status e create_task para escrever. Todas as operações respeitam as permissões do usuário conectado.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    listTenants,
    listLeads,
    getLead,
    createLead,
    updateLeadStatus,
    listPipelineStages,
    listAppointments,
    listTasks,
    createTask,
  ],
});
