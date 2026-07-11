import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, User, Building2, Save, Pencil } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { FIELDS_BY_KIND, type EntityKind } from "@/lib/entity-fields";
import {
  useClientData,
  type ClientKind,
  type PatientRow,
  type TenantClientRow,
  type PatientOnboardingRow,
} from "@/hooks/useClientData";
import UnifiedLeadPanel from "@/components/leads/UnifiedLeadPanel";

interface Props {
  kind: ClientKind | null;
  id: string | null;
  open: boolean;
  onClose: () => void;
}

const BRL = (v: number | null | undefined) =>
  v == null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v);
const dt = (iso: string | null | undefined) =>
  iso ? format(new Date(iso), "dd/MM/yyyy", { locale: ptBR }) : "—";
const dtHm = (iso: string | null | undefined) =>
  iso ? format(new Date(iso), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR }) : "—";

// datetime-local <-> ISO
const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (s: string): string | null => (s ? new Date(s).toISOString() : null);

export default function ClientPanel({ kind, id, open, onClose }: Props) {
  const { data, loading, reload } = useClientData(open ? kind : null, open ? id : null);
  const [tab, setTab] = useState("summary");
  const [leadOpen, setLeadOpen] = useState(false);

  const entityKind: EntityKind = kind === "patient" ? "patient" : "tenant_client";
  const cfg = FIELDS_BY_KIND[entityKind];

  const leadOrigin = useMemo(() => {
    if (!data) return null;
    if (data.kind === "patient" && data.patient) {
      const lid = data.patient.source_lead_id || data.patient.source_form_lead_id;
      if (lid) return { source: "lead" as const, id: lid };
    }
    if (data.kind === "tenant_client" && data.tenantClient?.source_agency_lead_id) {
      return { source: "agency_lead" as const, id: data.tenantClient.source_agency_lead_id };
    }
    return null;
  }, [data]);

  const isPatient = data?.kind === "patient";
  const patient = data?.patient;
  const tc = data?.tenantClient;
  const title = isPatient ? patient?.name ?? "Paciente" : tc?.tenant_name ?? "Clínica cliente";
  const subtitle = isPatient ? patient?.whatsapp ?? patient?.email ?? "" : tc?.responsavel_nome ?? tc?.cnpj ?? "";

  return (
    <>
      <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
        <SheetContent side="right" className="w-full sm:max-w-2xl p-0 overflow-hidden flex flex-col">
          {loading || !data ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : (
            <>
              <SheetHeader className="p-5 border-b border-border/50 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center shrink-0">
                    {isPatient ? <User className="w-6 h-6 text-primary" /> : <Building2 className="w-6 h-6 text-primary" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <SheetTitle className="text-xl truncate text-left">{title}</SheetTitle>
                    {subtitle && <div className="text-sm text-muted-foreground truncate">{subtitle}</div>}
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      <Badge variant="outline" className="text-[10px] uppercase">
                        {isPatient ? "Paciente" : "Clínica cliente"}
                      </Badge>
                      <Badge variant="secondary" className="gap-1 text-[10px]">
                        <Pencil className="w-2.5 h-2.5" /> Editável
                      </Badge>
                    </div>
                  </div>
                </div>
              </SheetHeader>

              <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col overflow-hidden">
                <TabsList className="w-full justify-start px-5 rounded-none border-b border-border/50 bg-transparent flex-wrap h-auto">
                  <TabsTrigger value="summary">Resumo</TabsTrigger>
                  <TabsTrigger value="onboarding">Onboarding</TabsTrigger>
                  {isPatient && <TabsTrigger value="clinical">Prontuário</TabsTrigger>}
                  <TabsTrigger value="lead" disabled={!leadOrigin}>Histórico do lead</TabsTrigger>
                  <TabsTrigger value="sales">{isPatient ? "Vendas" : "Contratos"}</TabsTrigger>
                </TabsList>

                <div className="flex-1 overflow-y-auto p-5">
                  <TabsContent value="summary" className="mt-0">
                    {isPatient && patient
                      ? <PatientSummaryForm p={patient} onSaved={reload} />
                      : tc && <TenantClientSummaryForm c={tc} tenantId={id!} onSaved={reload} />}
                  </TabsContent>

                  <TabsContent value="onboarding" className="mt-0">
                    {isPatient && patient
                      ? <PatientOnboardingForm patientId={patient.id} row={data.onboarding} onSaved={reload} />
                      : tc && <TenantClientOnboardingForm c={tc} tenantId={id!} onSaved={reload} />}
                  </TabsContent>

                  {isPatient && (
                    <TabsContent value="clinical" className="mt-0">
                      <MedicalRecordsView rows={data.medicalRecords} />
                    </TabsContent>
                  )}

                  <TabsContent value="lead" className="mt-0">
                    {leadOrigin ? (
                      <div className="space-y-3">
                        <div className="text-sm text-muted-foreground">
                          Este cliente foi convertido a partir de um lead. Abra a ficha
                          original para consultar o histórico completo.
                        </div>
                        <Button variant="outline" onClick={() => setLeadOpen(true)}>
                          Abrir ficha do lead de origem
                        </Button>
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground italic">
                        Cliente cadastrado manualmente — sem lead de origem.
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="sales" className="mt-0">
                    {isPatient
                      ? <SalesView rows={data.sales} />
                      : <ContractsView agency={data.agencyContracts} saas={data.saasContracts} />}
                  </TabsContent>
                </div>
              </Tabs>
            </>
          )}
        </SheetContent>
      </Sheet>

      {leadOrigin && (
        <UnifiedLeadPanel
          source={leadOrigin.source}
          leadId={leadOrigin.id}
          open={leadOpen}
          onClose={() => setLeadOpen(false)}
        />
      )}

      {/* cfg garante que B2B não vaza para paciente */}
      {isPatient && cfg.summary.b2bBlock && (
        <div className="hidden">bug: b2bBlock true para paciente</div>
      )}
    </>
  );
}

/* ---------- Helpers de UI ---------- */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-border/50 p-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function SaveBar({ dirty, saving, onSave }: { dirty: boolean; saving: boolean; onSave: () => void }) {
  return (
    <div className="sticky bottom-0 -mx-5 px-5 py-3 bg-background/95 backdrop-blur border-t border-border/50 flex justify-end">
      <Button onClick={onSave} disabled={!dirty || saving} className="gap-2">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        {saving ? "Salvando..." : "Salvar alterações"}
      </Button>
    </div>
  );
}

/* ---------- Paciente: Resumo (editável) ---------- */

function PatientSummaryForm({ p, onSaved }: { p: PatientRow; onSaved: () => void }) {
  const [f, setF] = useState({
    name: p.name ?? "",
    whatsapp: p.whatsapp ?? "",
    email: p.email ?? "",
    cpf: p.cpf ?? "",
    sexo: p.sexo ?? "",
    birth_date: p.birth_date ?? "",
    origem: p.origem ?? "",
    status: p.status ?? "",
    primeiro_contato: p.primeiro_contato ?? "",
    observacoes: p.observacoes ?? "",
  });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setDirty(false); }, [p.id]);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((s) => ({ ...s, [k]: v })); setDirty(true); };

  async function save() {
    if (!f.name.trim()) { toast.error("Nome é obrigatório"); return; }
    if (f.birth_date) {
      const d = new Date(f.birth_date + "T00:00:00");
      if (isNaN(d.getTime())) { toast.error("Data de nascimento inválida"); return; }
    }
    setSaving(true);
    const { error } = await supabase.from("patients").update({
      name: f.name.trim(),
      whatsapp: f.whatsapp || null,
      email: f.email || null,
      cpf: f.cpf || null,
      sexo: f.sexo || null,
      birth_date: f.birth_date || null,
      origem: f.origem || null,
      status: f.status || null,
      primeiro_contato: f.primeiro_contato || null,
      observacoes: f.observacoes || null,
    }).eq("id", p.id);
    setSaving(false);
    if (error) { toast.error("Erro ao salvar: " + error.message); return; }
    toast.success("Paciente atualizado");
    setDirty(false);
    onSaved();
  }

  return (
    <div className="space-y-4 pb-2">
      <Section title="Identificação">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Label>Nome *</Label><Input value={f.name} onChange={(e) => set("name", e.target.value)} /></div>
          <div><Label>WhatsApp</Label><Input value={f.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} /></div>
          <div><Label>E-mail</Label><Input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} /></div>
          <div><Label>CPF</Label><Input value={f.cpf} onChange={(e) => set("cpf", e.target.value)} /></div>
          <div>
            <Label>Sexo</Label>
            <Select value={f.sexo || "_"} onValueChange={(v) => set("sexo", v === "_" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_">—</SelectItem>
                <SelectItem value="F">Feminino</SelectItem>
                <SelectItem value="M">Masculino</SelectItem>
                <SelectItem value="O">Outro</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>Data de nascimento</Label><Input type="date" value={f.birth_date} onChange={(e) => set("birth_date", e.target.value)} /></div>
        </div>
      </Section>

      <Section title="Origem & status">
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Origem</Label><Input value={f.origem} onChange={(e) => set("origem", e.target.value)} /></div>
          <div><Label>Status</Label><Input value={f.status} onChange={(e) => set("status", e.target.value)} /></div>
          <div><Label>Primeiro contato</Label><Input type="date" value={f.primeiro_contato} onChange={(e) => set("primeiro_contato", e.target.value)} /></div>
        </div>
      </Section>

      <Section title="Observações">
        <Textarea rows={4} value={f.observacoes} onChange={(e) => set("observacoes", e.target.value)} />
      </Section>

      <SaveBar dirty={dirty} saving={saving} onSave={save} />
    </div>
  );
}

/* ---------- Paciente: Onboarding (editável, upsert lazy) ---------- */

function PatientOnboardingForm({
  patientId, row, onSaved,
}: { patientId: string; row: PatientOnboardingRow | null; onSaved: () => void }) {
  const [f, setF] = useState({
    objetivo_principal: row?.objetivo_principal ?? "",
    procedimento_interesse: row?.procedimento_interesse ?? "",
    negociacao_status: row?.negociacao_status ?? "",
    valor_negociado: row?.valor_negociado?.toString() ?? "",
    forma_pagamento: row?.forma_pagamento ?? "",
    como_conheceu: row?.como_conheceu ?? "",
    melhor_horario_contato: row?.melhor_horario_contato ?? "",
    proximo_retorno_at: toLocalInput(row?.proximo_retorno_at),
    responsavel_clinico: row?.responsavel_clinico ?? "",
    observacoes: row?.observacoes ?? "",
  });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setDirty(false); }, [patientId, row?.id]);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((s) => ({ ...s, [k]: v })); setDirty(true); };

  async function save() {
    let valorNum: number | null = null;
    if (f.valor_negociado.trim()) {
      const n = Number(f.valor_negociado.replace(",", "."));
      if (isNaN(n)) { toast.error("Valor negociado inválido"); return; }
      valorNum = n;
    }
    setSaving(true);
    const payload = {
      patient_id: patientId,
      objetivo_principal: f.objetivo_principal || null,
      procedimento_interesse: f.procedimento_interesse || null,
      negociacao_status: f.negociacao_status || null,
      valor_negociado: valorNum,
      forma_pagamento: f.forma_pagamento || null,
      como_conheceu: f.como_conheceu || null,
      melhor_horario_contato: f.melhor_horario_contato || null,
      proximo_retorno_at: fromLocalInput(f.proximo_retorno_at),
      responsavel_clinico: f.responsavel_clinico || null,
      observacoes: f.observacoes || null,
    };
    const { error } = await supabase
      .from("patient_onboarding")
      .upsert(payload, { onConflict: "patient_id" });
    setSaving(false);
    if (error) { toast.error("Erro ao salvar: " + error.message); return; }
    toast.success("Onboarding salvo");
    setDirty(false);
    onSaved();
  }

  return (
    <div className="space-y-4 pb-2">
      <Section title="Objetivo & procedimento">
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Objetivo principal</Label><Input value={f.objetivo_principal} onChange={(e) => set("objetivo_principal", e.target.value)} /></div>
          <div><Label>Procedimento de interesse</Label><Input value={f.procedimento_interesse} onChange={(e) => set("procedimento_interesse", e.target.value)} /></div>
          <div><Label>Status da negociação</Label><Input value={f.negociacao_status} onChange={(e) => set("negociacao_status", e.target.value)} placeholder="ex: em negociação, fechado, desistiu" /></div>
          <div><Label>Valor negociado (R$)</Label><Input type="number" step="0.01" value={f.valor_negociado} onChange={(e) => set("valor_negociado", e.target.value)} /></div>
          <div><Label>Forma de pagamento</Label><Input value={f.forma_pagamento} onChange={(e) => set("forma_pagamento", e.target.value)} /></div>
          <div><Label>Como conheceu</Label><Input value={f.como_conheceu} onChange={(e) => set("como_conheceu", e.target.value)} /></div>
        </div>
      </Section>

      <Section title="Atendimento">
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Melhor horário de contato</Label><Input value={f.melhor_horario_contato} onChange={(e) => set("melhor_horario_contato", e.target.value)} placeholder="ex: manhã / após 18h" /></div>
          <div><Label>Próximo retorno</Label><Input type="datetime-local" value={f.proximo_retorno_at} onChange={(e) => set("proximo_retorno_at", e.target.value)} /></div>
          <div className="col-span-2"><Label>Responsável clínico</Label><Input value={f.responsavel_clinico} onChange={(e) => set("responsavel_clinico", e.target.value)} /></div>
        </div>
        {row?.onboarding_completed_at && (
          <div className="text-xs text-muted-foreground">Concluído em {dtHm(row.onboarding_completed_at)}</div>
        )}
      </Section>

      <Section title="Observações">
        <Textarea rows={4} value={f.observacoes} onChange={(e) => set("observacoes", e.target.value)} />
      </Section>

      <SaveBar dirty={dirty} saving={saving} onSave={save} />
    </div>
  );
}

/* ---------- Clínica-cliente: Resumo (editável) ---------- */

function TenantClientSummaryForm({
  c, tenantId, onSaved,
}: { c: TenantClientRow; tenantId: string; onSaved: () => void }) {
  const [f, setF] = useState({
    cnpj: c.cnpj ?? "",
    cidade: c.cidade ?? "",
    estado: c.estado ?? "",
    especialidade: c.especialidade ?? "",
    num_profissionais: c.num_profissionais ?? "",
    responsavel_nome: c.responsavel_nome ?? "",
    responsavel_whatsapp: c.responsavel_whatsapp ?? "",
    responsavel_email: c.responsavel_email ?? "",
    responsavel_cs: c.responsavel_cs ?? "",
  });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setDirty(false); }, [tenantId]);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((s) => ({ ...s, [k]: v })); setDirty(true); };

  async function save() {
    setSaving(true);
    const { error } = await supabase.from("tenant_client_profile").upsert({
      tenant_id: tenantId,
      cnpj: f.cnpj || null,
      cidade: f.cidade || null,
      estado: f.estado || null,
      especialidade: f.especialidade || null,
      num_profissionais: f.num_profissionais || null,
      responsavel_nome: f.responsavel_nome || null,
      responsavel_whatsapp: f.responsavel_whatsapp || null,
      responsavel_email: f.responsavel_email || null,
      responsavel_cs: f.responsavel_cs || null,
    }, { onConflict: "tenant_id" });
    setSaving(false);
    if (error) { toast.error("Erro ao salvar: " + error.message); return; }
    toast.success("Cliente atualizado");
    setDirty(false);
    onSaved();
  }

  return (
    <div className="space-y-4 pb-2">
      <Section title="Clínica">
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Nome</Label><Input value={c.tenant_name ?? ""} disabled /></div>
          <div><Label>Slug</Label><Input value={c.tenant_slug ?? ""} disabled /></div>
          <div><Label>CNPJ</Label><Input value={f.cnpj} onChange={(e) => set("cnpj", e.target.value)} /></div>
          <div><Label>Especialidade</Label><Input value={f.especialidade} onChange={(e) => set("especialidade", e.target.value)} /></div>
          <div><Label>Nº profissionais</Label><Input value={f.num_profissionais} onChange={(e) => set("num_profissionais", e.target.value)} /></div>
          <div><Label>Cidade</Label><Input value={f.cidade} onChange={(e) => set("cidade", e.target.value)} /></div>
          <div><Label>UF</Label><Input maxLength={2} value={f.estado} onChange={(e) => set("estado", e.target.value.toUpperCase())} /></div>
        </div>
      </Section>

      <Section title="Responsável">
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Nome</Label><Input value={f.responsavel_nome} onChange={(e) => set("responsavel_nome", e.target.value)} /></div>
          <div><Label>WhatsApp</Label><Input value={f.responsavel_whatsapp} onChange={(e) => set("responsavel_whatsapp", e.target.value)} /></div>
          <div><Label>E-mail</Label><Input type="email" value={f.responsavel_email} onChange={(e) => set("responsavel_email", e.target.value)} /></div>
          <div><Label>CS interno</Label><Input value={f.responsavel_cs} onChange={(e) => set("responsavel_cs", e.target.value)} /></div>
        </div>
      </Section>

      <SaveBar dirty={dirty} saving={saving} onSave={save} />
    </div>
  );
}

/* ---------- Clínica-cliente: Onboarding (editável) ---------- */

function TenantClientOnboardingForm({
  c, tenantId, onSaved,
}: { c: TenantClientRow; tenantId: string; onSaved: () => void }) {
  const [f, setF] = useState({
    responsavel_cs: c.responsavel_cs ?? "",
    proximo_checkin_at: toLocalInput(c.proximo_checkin_at),
    observacoes_conta: c.observacoes_conta ?? "",
  });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setDirty(false); }, [tenantId]);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((s) => ({ ...s, [k]: v })); setDirty(true); };

  async function save() {
    setSaving(true);
    const { error } = await supabase.from("tenant_client_profile").upsert({
      tenant_id: tenantId,
      responsavel_cs: f.responsavel_cs || null,
      proximo_checkin_at: fromLocalInput(f.proximo_checkin_at),
      observacoes_conta: f.observacoes_conta || null,
    }, { onConflict: "tenant_id" });
    setSaving(false);
    if (error) { toast.error("Erro ao salvar: " + error.message); return; }
    toast.success("Onboarding salvo");
    setDirty(false);
    onSaved();
  }

  return (
    <div className="space-y-4 pb-2">
      <Section title="Conta">
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Responsável CS</Label><Input value={f.responsavel_cs} onChange={(e) => set("responsavel_cs", e.target.value)} /></div>
          <div><Label>Próximo check-in</Label><Input type="datetime-local" value={f.proximo_checkin_at} onChange={(e) => set("proximo_checkin_at", e.target.value)} /></div>
        </div>
        {c.onboarding_completed_at && (
          <div className="text-xs text-muted-foreground">Concluído em {dtHm(c.onboarding_completed_at)}</div>
        )}
      </Section>
      <Section title="Observações da conta">
        <Textarea rows={4} value={f.observacoes_conta} onChange={(e) => set("observacoes_conta", e.target.value)} />
      </Section>
      <SaveBar dirty={dirty} saving={saving} onSave={save} />
    </div>
  );
}

/* ---------- Read-only: Prontuário / Vendas / Contratos ---------- */

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border/40 bg-muted/20 p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm text-foreground break-words">{value == null || value === "" ? "—" : value}</div>
    </div>
  );
}

function MedicalRecordsView({ rows }: { rows: import("@/hooks/useClientData").MedicalRecordRow[] }) {
  if (rows.length === 0) return <EmptyState>Nenhum registro clínico para este paciente.</EmptyState>;
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.id} className="rounded-md border border-border/50 bg-card/40 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <Badge variant="outline" className="text-[10px] uppercase">{r.record_type}</Badge>
            <div className="text-xs text-muted-foreground">{dtHm(r.created_at)}</div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <Field label="Queixa principal" value={r.chief_complaint} />
            <Field label="Diagnóstico" value={r.diagnosis} />
            <Field label="Alergias" value={r.allergies} />
            <Field label="Medicações" value={r.medications} />
            <Field label="Histórico médico" value={r.medical_history} />
            <Field label="Histórico estético" value={r.aesthetic_history} />
          </div>
          {r.treatment_plan && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Plano de tratamento</div>
              <div className="text-sm whitespace-pre-wrap">{r.treatment_plan}</div>
            </div>
          )}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Profissional: {r.professional_name || "—"}</span>
            <span>{r.consent_signed ? "Consentimento assinado" : "Sem consentimento"}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function SalesView({ rows }: { rows: import("@/hooks/useClientData").SaleRow[] }) {
  if (rows.length === 0) return <EmptyState>Nenhuma venda registrada para este paciente.</EmptyState>;
  const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border/50 bg-muted/20 p-3 flex justify-between text-sm">
        <span>{rows.length} venda(s)</span>
        <span className="font-semibold">{BRL(total)}</span>
      </div>
      {rows.map((s) => (
        <div key={s.id} className="rounded-md border border-border/40 p-3 grid grid-cols-2 gap-2 text-sm">
          <div><span className="text-muted-foreground text-xs">Data:</span> {dt(s.sale_date)}</div>
          <div><span className="text-muted-foreground text-xs">Valor:</span> {BRL(s.amount)}</div>
          <div><span className="text-muted-foreground text-xs">Pago:</span> {BRL(s.amount_paid)}</div>
          <div><span className="text-muted-foreground text-xs">Pendente:</span> {BRL(s.amount_pending)}</div>
          <div className="col-span-2"><span className="text-muted-foreground text-xs">Procedimento:</span> {s.procedure_name || "—"}</div>
          <div><span className="text-muted-foreground text-xs">Status:</span> {s.payment_status}</div>
          <div><span className="text-muted-foreground text-xs">Vendedor:</span> {s.seller_name || "—"}</div>
        </div>
      ))}
    </div>
  );
}

function ContractsView({
  agency, saas,
}: {
  agency: import("@/hooks/useClientData").AgencyContractRow[];
  saas: import("@/hooks/useClientData").SaasContractRow[];
}) {
  return (
    <div className="space-y-5">
      <Section title={`Contratos de agência (${agency.length})`}>
        {agency.length === 0
          ? <EmptyState>Nenhum contrato de agência.</EmptyState>
          : agency.map((c) => (
            <div key={c.id} className="rounded-md border border-border/40 p-3 grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-muted-foreground text-xs">Cliente:</span> {c.cliente_nome}</div>
              <div><span className="text-muted-foreground text-xs">Status:</span> {c.status}</div>
              <div><span className="text-muted-foreground text-xs">Valor:</span> {BRL(c.valor_total)}</div>
              <div><span className="text-muted-foreground text-xs">Comissão:</span> {BRL(c.valor_comissao)}</div>
              <div><span className="text-muted-foreground text-xs">Assinatura:</span> {dt(c.data_assinatura)}</div>
              <div><span className="text-muted-foreground text-xs">Duração:</span> {c.duracao_meses ?? "—"} meses</div>
            </div>
          ))}
      </Section>
      <Section title={`Contratos SaaS (${saas.length})`}>
        {saas.length === 0
          ? <EmptyState>Nenhum contrato SaaS.</EmptyState>
          : saas.map((c) => (
            <div key={c.id} className="rounded-md border border-border/40 p-3 grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-muted-foreground text-xs">Plano:</span> {c.plan}</div>
              <div><span className="text-muted-foreground text-xs">Status:</span> {c.status}</div>
              <div><span className="text-muted-foreground text-xs">MRR:</span> {BRL(c.mrr)}</div>
              <div><span className="text-muted-foreground text-xs">Ciclo:</span> {c.billing_cycle}</div>
              <div><span className="text-muted-foreground text-xs">Início:</span> {dt(c.started_at)}</div>
              <div><span className="text-muted-foreground text-xs">Renova em:</span> {dt(c.renews_at)}</div>
            </div>
          ))}
      </Section>
    </div>
  );
}
