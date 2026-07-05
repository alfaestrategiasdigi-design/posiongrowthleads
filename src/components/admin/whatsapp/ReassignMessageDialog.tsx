import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, ArrowRight } from "lucide-react";

type ConversationRow = {
  id: string;
  telefone: string | null;
  nome_contato: string | null;
  remote_jid: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  message: { id: string; conteudo?: string | null; conversation_id?: string | null; tenant_id?: string | null } | null;
  currentConversationId: string;
  tenantId?: string | null;
  onMoved?: () => void;
};

export function ReassignMessageDialog({ open, onClose, message, currentConversationId, tenantId, onMoved }: Props) {
  const [query, setQuery] = useState("");
  const [reason, setReason] = useState("");
  const [results, setResults] = useState<ConversationRow[]>([]);
  const [target, setTarget] = useState<ConversationRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) { setQuery(""); setReason(""); setTarget(null); setResults([]); }
  }, [open]);

  useEffect(() => {
    let ignore = false;
    const q = query.trim();
    if (q.length < 2) { setResults([]); return; }
    setLoading(true);
    const run = async () => {
      let sq = supabase.from("conversations")
        .select("id, telefone, nome_contato, remote_jid")
        .neq("id", currentConversationId)
        .or(`telefone.ilike.%${q}%,nome_contato.ilike.%${q}%`)
        .limit(15);
      if (tenantId) sq = sq.eq("tenant_id", tenantId);
      const { data } = await sq;
      if (!ignore) { setResults((data as ConversationRow[]) || []); setLoading(false); }
    };
    const t = setTimeout(run, 250);
    return () => { ignore = true; clearTimeout(t); };
  }, [query, currentConversationId, tenantId]);

  const submit = async () => {
    if (!message || !target) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-message-reassign", {
        body: {
          message_id: message.id,
          target_conversation_id: target.id,
          reason: reason.trim() || null,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Mensagem movida para a conversa selecionada.");
      onMoved?.();
      onClose();
    } catch (e: any) {
      toast.error(e?.message || "Falha ao mover mensagem.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Mover mensagem para outra conversa</DialogTitle>
          <DialogDescription>
            Use apenas quando você tiver certeza de qual é a conversa correta. O movimento é registrado em auditoria.
          </DialogDescription>
        </DialogHeader>

        {message && (
          <div className="rounded-md border border-border/50 bg-muted/30 p-2 text-xs">
            <div className="text-muted-foreground mb-0.5">Mensagem</div>
            <div className="truncate">{message.conteudo || "(mídia sem texto)"}</div>
          </div>
        )}

        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">Buscar conversa (telefone ou nome)</label>
          <Input placeholder="Ex: 5511... ou nome do contato" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="max-h-56 overflow-auto border rounded-md divide-y divide-border/40">
            {loading && <div className="p-3 text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Buscando...</div>}
            {!loading && results.length === 0 && query.trim().length >= 2 && (
              <div className="p-3 text-xs text-muted-foreground">Nenhuma conversa encontrada.</div>
            )}
            {results.map((r) => (
              <button
                key={r.id}
                onClick={() => setTarget(r)}
                className={`w-full text-left p-2 text-xs hover:bg-muted/50 ${target?.id === r.id ? "bg-primary/10 border-l-2 border-primary" : ""}`}
              >
                <div className="font-medium">{r.nome_contato || r.telefone || r.remote_jid}</div>
                <div className="text-muted-foreground">{r.telefone}</div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs text-muted-foreground">Motivo (opcional, fica em auditoria)</label>
          <Textarea rows={2} placeholder="Ex: reconheci que essa mensagem era do contato X" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>Cancelar</Button>
          <Button onClick={submit} disabled={!target || submitting}>
            {submitting ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Movendo...</> : <>Mover <ArrowRight className="w-3 h-3 ml-1" /></>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
