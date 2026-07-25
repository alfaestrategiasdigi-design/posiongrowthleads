import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Check, ChevronsUpDown, UserPlus, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type LeadOption = { id: string; nome_completo: string; whatsapp: string | null; origem: string | null };

interface Props {
  tenantId: string;
  value: string;                  // patient_name texto
  leadId: string | null;          // lead vinculado (ou null)
  onChange: (patientName: string, leadId: string | null) => void;
}

export default function LeadCombobox({ tenantId, value, leadId, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LeadOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    let cancel = false;
    const term = query.trim();
    setLoading(true);
    const t = setTimeout(async () => {
      let q = supabase
        .from("leads")
        .select("id,nome_completo,whatsapp,origem")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(25);
      if (term.length > 0) {
        q = q.or(`nome_completo.ilike.%${term}%,whatsapp.ilike.%${term}%`);
      }
      const { data } = await q;
      if (!cancel) setResults((data as LeadOption[]) || []);
      setLoading(false);
    }, 200);
    return () => { cancel = true; clearTimeout(t); };
  }, [query, tenantId, open]);

  const display = useMemo(() => {
    if (value) return value;
    return "Selecione ou digite o nome do cliente";
  }, [value]);

  return (
    <div className="space-y-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
          >
            <span className={cn("truncate", !value && "text-muted-foreground")}>{display}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-[320px]" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Buscar por nome ou telefone…" value={query} onValueChange={setQuery} />
            <CommandList>
              {loading && <div className="py-3 text-center text-xs text-muted-foreground">Buscando…</div>}
              {!loading && results.length === 0 && (
                <CommandEmpty>
                  <div className="py-3 text-xs text-muted-foreground space-y-2">
                    <div>Nenhum lead encontrado.</div>
                    {query.trim() && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="gap-1.5"
                        onClick={() => { onChange(query.trim(), null); setOpen(false); }}
                      >
                        <UserPlus className="w-3.5 h-3.5" /> Usar "{query.trim()}" (sem lead)
                      </Button>
                    )}
                  </div>
                </CommandEmpty>
              )}
              {results.length > 0 && (
                <CommandGroup heading="Leads do tenant">
                  {results.map((l) => (
                    <CommandItem
                      key={l.id}
                      value={l.id}
                      onSelect={() => { onChange(l.nome_completo, l.id); setOpen(false); }}
                    >
                      <Check className={cn("mr-2 h-4 w-4", leadId === l.id ? "opacity-100" : "opacity-0")} />
                      <div className="flex-1 min-w-0">
                        <div className="truncate text-sm">{l.nome_completo}</div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {l.whatsapp || "sem telefone"} {l.origem ? `· ${l.origem}` : ""}
                        </div>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {query.trim() && results.length > 0 && (
                <div className="p-2 border-t border-border/60">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="w-full justify-start gap-1.5 text-xs"
                    onClick={() => { onChange(query.trim(), null); setOpen(false); }}
                  >
                    <UserPlus className="w-3.5 h-3.5" /> Usar "{query.trim()}" como novo cliente (sem lead)
                  </Button>
                </div>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {leadId ? (
        <div className="flex items-center gap-1.5 text-[11px] text-emerald-500">
          <Check className="w-3 h-3" /> Vinculado ao lead do CRM
          <button
            type="button"
            className="ml-auto inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
            onClick={() => onChange(value, null)}
          >
            <X className="w-3 h-3" /> desvincular
          </button>
        </div>
      ) : value ? (
        <div className="text-[11px] text-muted-foreground">Sem vínculo com lead — será registrado como cliente avulso.</div>
      ) : null}
    </div>
  );
}
