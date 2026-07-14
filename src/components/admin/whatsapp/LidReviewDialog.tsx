import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, AlertTriangle, RefreshCw, Trash2 } from "lucide-react";
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
    const totals = { auto_merged: 0, renamed: 0, manual_review: 0, found: 0 };
    let totalRemaining = 0;
    try {
      for (let i = 0; i < 20; i++) {
        const { data, error } = await supabase.functions.invoke("whatsapp-lid-reconcile", {
          body: { ...(tenantId ? { tenant_id: tenantId } : {}), limit: 15, offset: 0 },
        });
        if (error) { toast.error(error.message); break; }
        const summary = (data as any)?.per_tenant ?? {};
        for (const key of Object.keys(summary)) {
          totals.auto_merged += summary[key].auto_merged ?? 0;
          totals.renamed += summary[key].renamed ?? 0;
          totals.manual_review += summary[key].manual_review ?? 0;
          totals.found += summary[key].found ?? 0;
        }
        totalRemaining = (data as any)?.remaining ?? 0;
        if (((data as any)?.processed ?? 0) === 0 || totalRemaining === 0) break;
        toast.message(`Processadas ${totals.found} — restam ${totalRemaining}`);
      }
      toast.success(`Reconciliação concluída — mescladas: ${totals.auto_merged}, renomeadas: ${totals.renamed}, revisão manual: ${totals.manual_review}`);
    } finally {
      setReconciling(false);
    }
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

  const deleteOne = async (id: string) => {
    if (!confirm("Excluir esta conversa @lid? As mensagens vinculadas também serão apagadas. Esta ação é irreversível.")) return;
    setBusyId(id);
    // Order matters: reactions -> messages -> conversation
    await supabase.from("message_reactions").delete().eq("conversation_id", id);
    await supabase.from("messages").delete().eq("conversation_id", id);
    const { error } = await supabase.from("conversations").delete().eq("id", id);
    setBusyId(null);
    if (error) return toast.error(error.message);
    toast.success("Conversa @lid excluída");
    await load();
    onDone?.();
  };

  const deleteAll = async () => {
    if (items.length === 0) return;
    if (!confirm(`Excluir TODAS as ${items.length} conversas @lid pendentes deste escopo? As mensagens serão apagadas. Esta ação é irreversível.`)) return;
    setReconciling(true);
    const ids = items.map((i) => i.id);
    await supabase.from("message_reactions").delete().in("conversation_id", ids);
    await supabase.from("messages").delete().in("conversation_id", ids);
    const { error } = await supabase.from("conversations").delete().in("id", ids);
    setReconciling(false);
    if (error) return toast.error(error.message);
    toast.success(`${ids.length} conversas @lid excluídas`);
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

        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Recarregar
          </Button>
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" onClick={deleteAll} disabled={reconciling || loading || items.length === 0}>
              <Trash2 className="w-4 h-4 mr-2" /> Excluir todas ({items.length})
            </Button>
            <Button size="sm" onClick={runReconcile} disabled={reconciling}>
              {reconciling ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Rodar reconciliação automática
            </Button>
          </div>
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
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => deleteOne(c.id)}
                    disabled={busyId === c.id}
                    title="Excluir esta conversa @lid"
                  >
                    <Trash2 className="w-4 h-4 text-rose-500" />
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
