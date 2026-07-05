import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import { toast } from "sonner";

type PendingConv = {
  id: string;
  tenant_id: string | null;
  remote_jid: string | null;
  telefone: string | null;
  nome_contato: string | null;
  ultima_interacao: string | null;
  lid_review_notes: string | null;
};

export function LidReviewDialog({
  open,
  onOpenChange,
  tenantId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tenantId: string | null;
  onDone?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [items, setItems] = useState<PendingConv[]>([]);
  const [phoneByConv, setPhoneByConv] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    let q = supabase
      .from("conversations")
      .select("id, tenant_id, remote_jid, telefone, nome_contato, ultima_interacao, lid_review_notes")
      .eq("needs_lid_review", true)
      .order("ultima_interacao", { ascending: false });
    q = tenantId ? q.eq("tenant_id", tenantId) : q.is("tenant_id", null);
    const { data, error } = await q;
    if (error) toast.error(error.message);
    setItems((data ?? []) as PendingConv[]);
    setLoading(false);
  };

  useEffect(() => { if (open) load(); }, [open, tenantId]);

  const runReconcile = async () => {
    setReconciling(true);
    const { data, error } = await supabase.functions.invoke("whatsapp-lid-reconcile", {
      body: tenantId ? { tenant_id: tenantId } : {},
    });
    setReconciling(false);
    if (error) return toast.error(error.message);
    const summary = (data as any)?.per_tenant ?? {};
    toast.success(`Reconciliação executada — ${Object.keys(summary).length} tenant(s) processado(s)`);
    await load();
    onDone?.();
  };

  const mergeInto = async (lidId: string, phone: string) => {
    if (!phone || phone.replace(/\D/g, "").length < 8) return toast.error("Número inválido");
    setBusyId(lidId);
    const { data, error } = await supabase.functions.invoke("whatsapp-lid-merge", {
      body: { lid_conversation_id: lidId, target_phone: phone },
    });
    setBusyId(null);
    if (error || !(data as any)?.ok) return toast.error((error?.message) || (data as any)?.error || "Falha ao mesclar");
    toast.success(`Ação: ${(data as any).action}`);
    await load();
    onDone?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            Revisão de conversas com identificador provisório (@lid)
          </DialogTitle>
          <DialogDescription>
            O WhatsApp entregou essas conversas com um ID temporário. Confirme o número real de cada uma
            para mesclar no histórico correto — ou execute a reconciliação automática para tentar resolver em lote.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2 mb-3">
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Recarregar
          </Button>
          <Button size="sm" onClick={runReconcile} disabled={reconciling}>
            {reconciling ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Rodar reconciliação automática
          </Button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto space-y-2">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin inline-block mr-2" /> Carregando…
            </div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Nenhuma conversa pendente de revisão.
            </div>
          ) : (
            items.map((c) => (
              <div key={c.id} className="border rounded-lg p-3 flex flex-col gap-2 bg-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{c.nome_contato || "(sem nome)"}</div>
                    <div className="text-xs text-muted-foreground font-mono truncate">{c.remote_jid}</div>
                    {c.lid_review_notes && (
                      <div className="text-xs text-amber-600 dark:text-amber-400 mt-1">{c.lid_review_notes}</div>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="Número real com DDI (ex.: 5511999998888)"
                    value={phoneByConv[c.id] ?? ""}
                    onChange={(e) => setPhoneByConv((s) => ({ ...s, [c.id]: e.target.value }))}
                    className="flex-1"
                  />
                  <Button
                    size="sm"
                    onClick={() => mergeInto(c.id, phoneByConv[c.id] ?? "")}
                    disabled={busyId === c.id}
                  >
                    {busyId === c.id ? <Loader2 className="w-4 h-4 animate-spin" /> : "Mesclar"}
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
