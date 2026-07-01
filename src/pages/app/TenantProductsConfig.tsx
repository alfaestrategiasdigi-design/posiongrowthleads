import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Loader2, Trash2, Package, Edit2 } from "lucide-react";

interface Product {
  id: string;
  tenant_id: string;
  nome: string;
  categoria: string | null;
  preco_sugerido: number | null;
  duracao_min: number | null;
  ativo: boolean;
  ordem: number | null;
}

const fmt = (v: number | null) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);

export default function TenantProductsConfig() {
  const { tenant } = useTenant();
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Product | "new" | null>(null);

  const load = async () => {
    if (!tenant?.id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("tenant_products").select("*").eq("tenant_id", tenant.id)
      .order("ordem", { ascending: true }).order("nome");
    if (error) toast.error(error.message);
    else setItems((data || []) as Product[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, [tenant?.id]);

  const remove = async (id: string) => {
    if (!confirm("Excluir este produto?")) return;
    const { error } = await supabase.from("tenant_products").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Removido"); load(); }
  };
  const toggle = async (p: Product) => {
    const { error } = await supabase.from("tenant_products").update({ ativo: !p.ativo }).eq("id", p.id);
    if (error) toast.error(error.message); else load();
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Package className="w-6 h-6 text-primary" /> Produtos & Procedimentos</h1>
          <p className="text-sm text-muted-foreground mt-1">Catálogo próprio da sua clínica. Usado no Kanban, Agenda e Vendas.</p>
        </div>
        <Button onClick={() => setEditing("new")}><Plus className="w-4 h-4 mr-2" />Novo</Button>
      </div>

      {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : items.length === 0 ? (
        <div className="text-center py-16 rounded-xl border border-dashed border-border">
          <Package className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-muted-foreground text-sm mb-4">Nenhum produto ainda. Cadastre os procedimentos que sua clínica oferece.</p>
          <Button onClick={() => setEditing("new")}><Plus className="w-4 h-4 mr-2" />Cadastrar primeiro</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map((p) => (
            <div key={p.id} className={`rounded-xl border p-4 space-y-2 ${p.ativo ? "border-border/60 bg-card/40" : "border-border/30 bg-muted/20 opacity-60"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold truncate">{p.nome}</div>
                  {p.categoria && <div className="text-xs text-muted-foreground">{p.categoria}</div>}
                </div>
                <Switch checked={p.ativo} onCheckedChange={() => toggle(p)} />
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-primary font-semibold">{fmt(p.preco_sugerido)}</span>
                <span className="text-xs text-muted-foreground">{p.duracao_min || 60} min</span>
              </div>
              <div className="flex gap-1 pt-2 border-t border-border/40">
                <Button variant="ghost" size="sm" className="flex-1" onClick={() => setEditing(p)}><Edit2 className="w-3 h-3 mr-1" />Editar</Button>
                <Button variant="ghost" size="sm" onClick={() => remove(p.id)}><Trash2 className="w-3 h-3 text-destructive" /></Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ProductDialog
        item={editing}
        tenantId={tenant?.id}
        onOpenChange={(o) => !o && setEditing(null)}
        onSaved={() => { setEditing(null); load(); }}
      />
    </div>
  );
}

function ProductDialog({ item, tenantId, onOpenChange, onSaved }: { item: Product | "new" | null; tenantId?: string; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const open = !!item;
  const p = item === "new" ? null : (item as Product | null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ nome: "", categoria: "", preco_sugerido: 0, duracao_min: 60, ativo: true });

  useEffect(() => {
    if (p) setForm({ nome: p.nome, categoria: p.categoria || "", preco_sugerido: Number(p.preco_sugerido || 0), duracao_min: p.duracao_min || 60, ativo: p.ativo });
    else setForm({ nome: "", categoria: "", preco_sugerido: 0, duracao_min: 60, ativo: true });
  }, [item]);

  const save = async () => {
    if (!form.nome.trim()) { toast.error("Nome obrigatório"); return; }
    if (!tenantId) return;
    setSaving(true);
    const payload = { ...form, tenant_id: tenantId };
    const { error } = p
      ? await supabase.from("tenant_products").update(payload).eq("id", p.id)
      : await supabase.from("tenant_products").insert(payload);
    setSaving(false);
    if (error) toast.error(error.message);
    else { toast.success("Salvo"); onSaved(); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{p ? "Editar Produto" : "Novo Produto"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Nome *</Label><Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Ex: Consulta Nutro" /></div>
          <div><Label>Categoria</Label><Input value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} placeholder="Ex: Consultas, Procedimentos..." /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Preço sugerido (R$)</Label><Input type="number" value={form.preco_sugerido} onChange={(e) => setForm({ ...form, preco_sugerido: Number(e.target.value) })} /></div>
            <div><Label>Duração (min)</Label><Input type="number" value={form.duracao_min} onChange={(e) => setForm({ ...form, duracao_min: Number(e.target.value) })} /></div>
          </div>
          <div className="flex items-center gap-2"><Switch checked={form.ativo} onCheckedChange={(v) => setForm({ ...form, ativo: v })} /><Label>Ativo</Label></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
