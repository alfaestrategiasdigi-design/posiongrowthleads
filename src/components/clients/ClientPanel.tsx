import { useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, User, Building2, Lock } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { FIELDS_BY_KIND, type EntityKind } from "@/lib/entity-fields";
import { useClientData, type ClientKind, type PatientRow, type TenantClientRow } from "@/hooks/useClientData";
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

export default function ClientPanel({ kind, id, open, onClose }: Props) {
  const { data, loading } = useClientData(open ? kind : null, open ? id : null);
  const [tab, setTab] = useState("summary");
  const [leadOpen, setLeadOpen] = useState(false);

  const entityKind: EntityKind = kind === "patient" ? "patient" : "tenant_client";
  const cfg = FIELDS_BY_KIND[entityKind];

  // Origem do lead (para aba Histórico)
  const leadOrigin = useMemo(() => {
    if (!data) return null;
    if (data.kind === "patient" && data.patient) {
      if (data.patient.source_lead_id) return { source: "lead" as const, id: data.patient.source_lead_id };
      if (data.patient.source_form_lead_id) return { source: "lead" as const, id: data.patient.source_form_lead_id };
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
                        <Lock className="w-2.5 h-2.5" /> Somente leitura
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
                  <TabsTrigger value="sales">
                    {isPatient ? "Vendas" : "Contratos"}
                  </TabsTrigger>
                </TabsList>

                <div className="flex-1 overflow-y-auto p-5">
                  <TabsContent value="summary" className="mt-0">
                    {isPatient && patient ? <PatientSummary p={patient} cfg={cfg.summary} /> : tc && <TenantClientSummary c={tc} />}
                  </TabsContent>

                  <TabsContent value="onboarding" className="mt-0">
                    {isPatient
                      ? <PatientOnboardingView row={data.onboarding} />
                      : tc && <TenantClientOnboardingView c={tc} />}
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

      {/* Ficha do lead de origem (read-only na prática porque o painel de cliente não persiste) */}
      {leadOrigin && (
        <UnifiedLeadPanel
          source={leadOrigin.source}
          leadId={leadOrigin.id}
          open={leadOpen}
          onClose={() => setLeadOpen(false)}
        />
      )}
    </>
  );
}

/* ---------- Sub-views (read-only) ---------- */

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border/40 bg-muted/20 p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm text-foreground break-words">{value == null || value === "" ? "—" : value}</div>
    </div>
  );
}

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

function PatientSummary({ p, cfg }: { p: PatientRow; cfg: typeof FIELDS_BY_KIND["patient"]["summary"] }) {
  const end = p.endereco || {};
  return (
    <div className="space-y-4">
      <Section title="Identificação">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Nome" value={p.name} />
          <Field label="WhatsApp" value={p.whatsapp} />
          <Field label="E-mail" value={p.email} />
          <Field label="CPF" value={p.cpf} />
          <Field label="Sexo" value={p.sexo} />
          <Field label="Nascimento" value={dt(p.birth_date)} />
        </div>
      </Section>

      <Section title="Origem & status">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Origem" value={p.origem} />
          <Field label="Status" value={p.status} />
          <Field label="Primeiro contato" value={dt(p.primeiro_contato)} />
          <Field label="Promovido em" value={dtHm(p.promoted_at)} />
        </div>
      </Section>

      {(end.rua || end.cidade || end.uf || end.cep) && (
        <Section title="Endereço">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Rua" value={end.rua} />
            <Field label="Número" value={end.numero} />
            <Field label="Bairro" value={end.bairro} />
            <Field label="Cidade" value={end.cidade} />
            <Field label="UF" value={end.uf} />
            <Field label="CEP" value={end.cep} />
          </div>
        </Section>
      )}

      {p.tags && p.tags.length > 0 && (
        <Section title="Tags">
          <div className="flex flex-wrap gap-1">
            {p.tags.map((t) => <Badge key={t} variant="secondary">{t}</Badge>)}
          </div>
        </Section>
      )}

      {p.observacoes && (
        <Section title="Observações">
          <div className="text-sm whitespace-pre-wrap rounded-md border border-border/40 bg-muted/20 p-3">{p.observacoes}</div>
        </Section>
      )}

      {/* cfg garante que campos B2B NÃO aparecem para paciente */}
      {cfg.b2bBlock && (
        <div className="text-xs text-destructive">Bug: bloco B2B não deveria aparecer para paciente.</div>
      )}
    </div>
  );
}

function TenantClientSummary({ c }: { c: TenantClientRow }) {
  return (
    <div className="space-y-4">
      <Section title="Clínica">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Nome" value={c.tenant_name} />
          <Field label="Slug" value={c.tenant_slug} />
          <Field label="CNPJ" value={c.cnpj} />
          <Field label="Especialidade" value={c.especialidade} />
          <Field label="Nº profissionais" value={c.num_profissionais} />
          <Field label="Cidade / UF" value={[c.cidade, c.estado].filter(Boolean).join(" / ")} />
        </div>
      </Section>
      <Section title="Responsável">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Nome" value={c.responsavel_nome} />
          <Field label="WhatsApp" value={c.responsavel_whatsapp} />
          <Field label="E-mail" value={c.responsavel_email} />
          <Field label="CS interno" value={c.responsavel_cs} />
        </div>
      </Section>
    </div>
  );
}

function PatientOnboardingView({ row }: { row: import("@/hooks/useClientData").PatientOnboardingRow | null }) {
  if (!row) {
    return <EmptyState>Nenhum onboarding registrado ainda para este paciente.</EmptyState>;
  }
  return (
    <div className="space-y-4">
      <Section title="Objetivo & procedimento">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Objetivo principal" value={row.objetivo_principal} />
          <Field label="Procedimento de interesse" value={row.procedimento_interesse} />
          <Field label="Status da negociação" value={row.negociacao_status} />
          <Field label="Valor negociado" value={BRL(row.valor_negociado)} />
          <Field label="Forma de pagamento" value={row.forma_pagamento} />
          <Field label="Como conheceu" value={row.como_conheceu} />
        </div>
      </Section>
      <Section title="Atendimento">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Melhor horário de contato" value={row.melhor_horario_contato} />
          <Field label="Próximo retorno" value={dtHm(row.proximo_retorno_at)} />
          <Field label="Responsável clínico" value={row.responsavel_clinico} />
          <Field label="Concluído em" value={dtHm(row.onboarding_completed_at)} />
        </div>
      </Section>
      {row.observacoes && (
        <Section title="Observações">
          <div className="text-sm whitespace-pre-wrap rounded-md border border-border/40 bg-muted/20 p-3">{row.observacoes}</div>
        </Section>
      )}
    </div>
  );
}

function TenantClientOnboardingView({ c }: { c: TenantClientRow }) {
  const hasAny = c.responsavel_cs || c.proximo_checkin_at || c.observacoes_conta || c.onboarding_completed_at;
  if (!hasAny) return <EmptyState>Nenhum onboarding de conta registrado ainda para esta clínica.</EmptyState>;
  return (
    <div className="space-y-4">
      <Section title="Conta">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Responsável CS" value={c.responsavel_cs} />
          <Field label="Próximo check-in" value={dtHm(c.proximo_checkin_at)} />
          <Field label="Onboarding concluído em" value={dtHm(c.onboarding_completed_at)} />
        </div>
      </Section>
      {c.observacoes_conta && (
        <Section title="Observações da conta">
          <div className="text-sm whitespace-pre-wrap rounded-md border border-border/40 bg-muted/20 p-3">{c.observacoes_conta}</div>
        </Section>
      )}
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
          {Array.isArray(r.attachments) && r.attachments.length > 0 && (
            <div className="text-xs text-muted-foreground">
              {r.attachments.length} anexo(s)
            </div>
          )}
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
              <div><span className="text-muted-foreground text-xs">Assinado em:</span> {dt(c.data_assinatura)}</div>
              <div><span className="text-muted-foreground text-xs">Valor total:</span> {BRL(c.valor_total)}</div>
              <div><span className="text-muted-foreground text-xs">Comissão:</span> {BRL(c.valor_comissao)}</div>
              <div><span className="text-muted-foreground text-xs">Duração:</span> {c.duracao_meses ? `${c.duracao_meses} meses` : "—"}</div>
              <div><span className="text-muted-foreground text-xs">Status:</span> {c.status}</div>
              {c.observacoes && <div className="col-span-2 text-xs text-muted-foreground whitespace-pre-wrap">{c.observacoes}</div>}
            </div>
          ))}
      </Section>
      <Section title={`Contratos SaaS (${saas.length})`}>
        {saas.length === 0
          ? <EmptyState>Nenhum contrato SaaS.</EmptyState>
          : saas.map((c) => (
            <div key={c.id} className="rounded-md border border-border/40 p-3 grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-muted-foreground text-xs">Plano:</span> {c.plan}</div>
              <div><span className="text-muted-foreground text-xs">MRR:</span> {BRL(c.mrr)}</div>
              <div><span className="text-muted-foreground text-xs">Ciclo:</span> {c.billing_cycle}</div>
              <div><span className="text-muted-foreground text-xs">Status:</span> {c.status}</div>
              <div><span className="text-muted-foreground text-xs">Início:</span> {dt(c.started_at)}</div>
              <div><span className="text-muted-foreground text-xs">Renova em:</span> {dt(c.renews_at)}</div>
              {c.canceled_at && <div className="col-span-2"><span className="text-muted-foreground text-xs">Cancelado em:</span> {dtHm(c.canceled_at)}</div>}
              {c.notes && <div className="col-span-2 text-xs text-muted-foreground whitespace-pre-wrap">{c.notes}</div>}
            </div>
          ))}
      </Section>
    </div>
  );
}
