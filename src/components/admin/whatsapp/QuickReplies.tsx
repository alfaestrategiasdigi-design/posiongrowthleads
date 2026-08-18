import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, Pencil, Plus, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";

export interface MessageTemplate {
  id: string;
  tenant_id: string | null;
  title: string;
  body: string;
  shortcut: string | null;
}

/** Substitui variáveis simples do modelo pelo contexto do contato. */
export function applyTemplateVars(body: string, vars: { nome?: string | null }) {
  const nome = (vars.nome || "").trim();
  return body
    .replace(/\{\{\s*(nome|name|contato)\s*\}\}/gi, nome || "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export default function QuickReplies({
  tenantId,
  contactName,
  onPick,
}: {
  tenantId?: string | null;
  contactName?: string | null;
  onPick: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Partial<MessageTemplate> | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase.from("message_templates").select("id, tenant_id, title, body, shortcut");
    if (tenantId) q = q.or(`tenant_id.eq.${tenantId},tenant_id.is.null`);
    else q = q.is("tenant_id", null);
    const { data, error } = await q.order("title", { ascending: true });
    if (error) toast.error("Não foi possível carregar as mensagens modelo");
    setItems((data as MessageTemplate[]) || []);
    setLoading(false);
  }, [tenantId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const save = async () => {
    if (!editing) return;
    const title = String(editing.title || "").trim();
    const body = String(editing.body || "").trim();
    if (!title || !body) {
      toast.error("Preencha título e mensagem");
      return;
    }
    setSaving(true);
    const payload: any = {
      title,
      body,
      shortcut: String(editing.shortcut || "").trim() || null,
      tenant_id: tenantId ?? null,
    };
    const { error } = editing.id
      ? await supabase.from("message_templates").update(payload).eq("id", editing.id)
      : await supabase.from("message_templates").insert({
          ...payload,
          created_by: (await supabase.auth.getUser()).data.user?.id ?? null,
        });
    setSaving(false);
    if (error) {
      toast.error("Não foi possível salvar o modelo");
      return;
    }
    toast.success(editing.id ? "Modelo atualizado" : "Modelo criado");
    setEditing(null);
    load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("message_templates").delete().eq("id", id);
    if (error) return toast.error("Não foi possível excluir");
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const filtered = items.filter((i) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return `${i.title} ${i.body} ${i.shortcut ?? ""}`.toLowerCase().includes(q);
  });

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button className="wa-icon-btn !h-10 !w-10 shrink-0" title="Mensagens modelo">
            <Zap className="w-5 h-5" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" side="top" className="w-80 p-0 overflow-hidden">
          <div className="p-2 border-b border-border/50 flex items-center gap-2">
            <Input
              placeholder="Buscar modelo…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 text-xs"
            />
            <Button
              size="sm"
              className="h-8 gap-1 shrink-0"
              onClick={() => setEditing({ title: "", body: "", shortcut: "" })}
            >
              <Plus className="w-3.5 h-3.5" /> Novo
            </Button>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {loading ? (
              <div className="p-6 flex justify-center"><Loader2 className="w-4 h-4 animate-spin" /></div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">
                Nenhuma mensagem modelo ainda. Clique em “Novo” para criar a primeira.
              </div>
            ) : (
              <ul className="divide-y divide-border/40">
                {filtered.map((t) => (
                  <li key={t.id} className="group flex items-start gap-2 p-2 hover:bg-muted/40">
                    <button
                      className="flex-1 text-left min-w-0"
                      onClick={() => {
                        onPick(applyTemplateVars(t.body, { nome: contactName }));
                        setOpen(false);
                      }}
                    >
                      <div className="text-xs font-medium truncate">
                        {t.title}
                        {t.shortcut && (
                          <span className="ml-2 text-[10px] text-muted-foreground">/{t.shortcut}</span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground line-clamp-2">{t.body}</div>
                    </button>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button className="p-1 text-muted-foreground hover:text-foreground" onClick={() => setEditing(t)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button className="p-1 text-muted-foreground hover:text-rose-400" onClick={() => remove(t.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </PopoverContent>
      </Popover>

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Editar mensagem modelo" : "Nova mensagem modelo"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Título</Label>
              <Input
                value={editing?.title ?? ""}
                onChange={(e) => setEditing((p) => ({ ...p, title: e.target.value }))}
                placeholder="Ex.: Boas-vindas"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Atalho (opcional)</Label>
              <Input
                value={editing?.shortcut ?? ""}
                onChange={(e) => setEditing((p) => ({ ...p, shortcut: e.target.value }))}
                placeholder="boasvindas"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Mensagem</Label>
              <Textarea
                rows={5}
                value={editing?.body ?? ""}
                onChange={(e) => setEditing((p) => ({ ...p, body: e.target.value }))}
                placeholder="Olá {{nome}}, tudo bem? …"
              />
              <p className="text-[10px] text-muted-foreground">
                Use <code>{"{{nome}}"}</code> para inserir o nome do contato automaticamente.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
