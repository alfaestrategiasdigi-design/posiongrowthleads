import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  User, Phone, Mail, Building2, MapPin, FileText, Calendar, MessageCircle,
  Stethoscope, Users, TrendingUp, Wallet, DollarSign, Loader2, Save,
} from "lucide-react";
import { PIPELINE_STAGES, ORIGEM_LABELS } from "@/types/admin";
import type { Lead } from "@/types/admin";

interface LeadDetailModalProps {
  lead: Lead | null;
  open: boolean;
  onClose: () => void;
  onUpdated?: () => void;
}

const LeadDetailModal = ({ lead, open, onClose, onUpdated }: LeadDetailModalProps) => {
  const [status, setStatus] = useState<string>("lead");
  const [valor, setValor] = useState<string>("");
  const [motivoPerda, setMotivoPerda] = useState<string>("");
  const [observacoes, setObservacoes] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (lead) {
      setStatus(lead.status);
      setValor(lead.valor_proposta ? String(lead.valor_proposta) : "");
      setMotivoPerda(lead.motivo_perda ?? "");
      setObservacoes(lead.observacoes ?? "");
    }
  }, [lead]);

  if (!lead) return null;

  const whatsappNumber = lead.whatsapp.replace(/\D/g, "");
  const whatsappLink = `https://wa.me/55${whatsappNumber}?text=Olá ${lead.nome_completo.split(" ")[0]}, aqui é da Posion Growth!`;

  const stageInfo = PIPELINE_STAGES.find((s) => s.id === status) ?? PIPELINE_STAGES[0];
  const origemInfo = ORIGEM_LABELS[lead.origem ?? "site"] ?? ORIGEM_LABELS.outro;

  const handleSave = async () => {
    setSaving(true);
    const now = new Date().toISOString();
    const patch: Record<string, any> = {
      status,
      valor_proposta: valor ? Number(valor) : null,
      motivo_perda: motivoPerda || null,
      observacoes: observacoes || null,
    };
    if (status === "qualificado") { patch.mql = true; patch.sql_qualified = true; }
    if (status === "reuniao_agendada" && !lead.reuniao_agendada_em) patch.reuniao_agendada_em = now;
    if (status === "compareceu" && !lead.reuniao_realizada_em) patch.reuniao_realizada_em = now;
    if (status === "negociacao" && !lead.proposta_enviada_em) patch.proposta_enviada_em = now;
    if ((status === "ganho" || status === "perdido") && !lead.fechado_em) patch.fechado_em = now;

    const { error } = await supabase.from("leads").update(patch as any).eq("id", lead.id);
    setSaving(false);
    if (error) { toast.error("Erro ao salvar"); return; }
    toast.success("Lead atualizado");
    onUpdated?.();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center">
              <User className="w-6 h-6 text-accent" />
            </div>
            <div className="flex-1">
              <span className="block text-foreground">{lead.nome_completo}</span>
              <div className="flex items-center gap-2 mt-1">
                <span className={`inline-flex text-[10px] px-2 py-0.5 rounded-full text-white bg-gradient-to-r ${stageInfo.color}`}>
                  {stageInfo.title}
                </span>
                <span className={`inline-flex text-[10px] px-2 py-0.5 rounded-full font-medium ${origemInfo.color}`}>
                  {origemInfo.label}
                </span>
              </div>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* Editor de pipeline */}
          <div className="bg-accent/5 border border-accent/20 rounded-lg p-4 space-y-3">
            <h4 className="text-sm font-semibold text-foreground">Pipeline</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Etapa</label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PIPELINE_STAGES.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Valor da proposta (R$)</label>
                <Input type="number" min="0" step="100" placeholder="0,00" value={valor} onChange={(e) => setValor(e.target.value)} />
              </div>
            </div>
            {status === "perdido" && (
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Motivo da perda</label>
                <Input placeholder="Ex: sem budget, prazo, escolheu concorrente..." value={motivoPerda} onChange={(e) => setMotivoPerda(e.target.value)} />
              </div>
            )}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Observações comerciais</label>
              <Textarea rows={2} placeholder="Notas internas sobre o lead..." value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
            </div>
          </div>

          {/* Contato + clínica + perfil */}
          <div className="grid md:grid-cols-2 gap-3">
            <div className="bg-muted/40 rounded-lg p-4 space-y-2 text-sm">
              <h4 className="text-xs font-semibold text-foreground flex items-center gap-2 mb-1">
                <Phone className="w-3.5 h-3.5 text-accent" /> Contato
              </h4>
              <div className="flex items-center gap-2 text-muted-foreground"><Phone className="w-3.5 h-3.5" /> {lead.whatsapp}</div>
              {lead.email && <div className="flex items-center gap-2 text-muted-foreground"><Mail className="w-3.5 h-3.5" /> {lead.email}</div>}
            </div>
            <div className="bg-muted/40 rounded-lg p-4 space-y-2 text-sm">
              <h4 className="text-xs font-semibold text-foreground flex items-center gap-2 mb-1">
                <Building2 className="w-3.5 h-3.5 text-accent" /> Empresa
              </h4>
              {lead.nome_empresa && <div className="flex items-center gap-2 text-muted-foreground"><Building2 className="w-3.5 h-3.5" /> {lead.nome_empresa}</div>}
              {lead.cnpj && <div className="flex items-center gap-2 text-muted-foreground"><FileText className="w-3.5 h-3.5" /> {lead.cnpj}</div>}
              {lead.cidade_estado && <div className="flex items-center gap-2 text-muted-foreground"><MapPin className="w-3.5 h-3.5" /> {lead.cidade_estado}</div>}
            </div>
          </div>

          <div className="bg-muted/40 rounded-lg p-4 grid md:grid-cols-2 gap-2 text-sm">
            <h4 className="md:col-span-2 text-xs font-semibold text-foreground flex items-center gap-2 mb-1">
              <TrendingUp className="w-3.5 h-3.5 text-accent" /> Diagnóstico
            </h4>
            {lead.especialidade && <div className="flex items-center gap-2 text-muted-foreground"><Stethoscope className="w-3.5 h-3.5" /> {lead.especialidade}</div>}
            {lead.num_profissionais && <div className="flex items-center gap-2 text-muted-foreground"><Users className="w-3.5 h-3.5" /> {lead.num_profissionais} profissionais</div>}
            {lead.investiu_trafego && <div className="flex items-center gap-2 text-muted-foreground"><TrendingUp className="w-3.5 h-3.5" /> {lead.investiu_trafego}</div>}
            {lead.faturamento_mensal && <div className="flex items-center gap-2 text-muted-foreground"><Wallet className="w-3.5 h-3.5" /> {lead.faturamento_mensal}</div>}
            {lead.valor_proposta != null && (
              <div className="flex items-center gap-2 text-accent font-semibold">
                <DollarSign className="w-3.5 h-3.5" /> Proposta: R$ {Number(lead.valor_proposta).toLocaleString("pt-BR")}
              </div>
            )}
          </div>

          {/* Histórico do funil */}
          <div className="bg-muted/40 rounded-lg p-4 space-y-1.5 text-xs text-muted-foreground">
            <h4 className="text-xs font-semibold text-foreground flex items-center gap-2 mb-2">
              <Calendar className="w-3.5 h-3.5 text-accent" /> Histórico
            </h4>
            <p>Criado: {format(new Date(lead.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</p>
            {lead.reuniao_agendada_em && <p>Reunião agendada: {format(new Date(lead.reuniao_agendada_em), "dd/MM/yyyy HH:mm", { locale: ptBR })}</p>}
            {lead.reuniao_realizada_em && <p>Reunião realizada: {format(new Date(lead.reuniao_realizada_em), "dd/MM/yyyy HH:mm", { locale: ptBR })}</p>}
            {lead.proposta_enviada_em && <p>Proposta enviada: {format(new Date(lead.proposta_enviada_em), "dd/MM/yyyy HH:mm", { locale: ptBR })}</p>}
            {lead.fechado_em && <p>Fechado em: {format(new Date(lead.fechado_em), "dd/MM/yyyy HH:mm", { locale: ptBR })}</p>}
            {lead.facebook_campaign && <p>Campanha FB: {lead.facebook_campaign}</p>}
            {lead.utm_source && <p>UTM: {lead.utm_source} / {lead.utm_medium ?? "-"} / {lead.utm_campaign ?? "-"}</p>}
          </div>
        </div>

        <div className="flex gap-3 mt-6 pt-4 border-t border-border">
          <Button onClick={handleSave} disabled={saving} className="flex-1 gradient-accent hover:opacity-90">
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Salvar alterações
          </Button>
          <Button onClick={() => window.open(whatsappLink, "_blank")} variant="outline" className="bg-green-600/10 border-green-600/30 hover:bg-green-600/20">
            <MessageCircle className="w-4 h-4 mr-2 text-green-500" /> WhatsApp
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default LeadDetailModal;
