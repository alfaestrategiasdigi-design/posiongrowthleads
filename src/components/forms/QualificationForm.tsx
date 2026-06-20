import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { maskPhone } from "@/lib/masks";
import { toast } from "sonner";

type FieldType = "text" | "tel" | "choice" | "email";

type FieldDef = {
  key: string;
  label: string;
  question: string;
  type: FieldType;
  placeholder?: string | null;
  options?: string[];
  required: boolean;
  disqualify_values: string[];
  db_column?: string | null;
};

// Fallback steps if table is empty (keeps form working out-of-the-box)
const FALLBACK: FieldDef[] = [
  { key: "nomeCompleto", label: "Quem é você", question: "Qual o seu nome?", type: "text", placeholder: "Nome do responsável (médico/gestor)", required: true, disqualify_values: [], db_column: "nome_completo" },
  { key: "whatsapp", label: "Contato", question: "Qual seu WhatsApp com DDD?", type: "tel", placeholder: "(00) 00000-0000", required: true, disqualify_values: [], db_column: "whatsapp" },
  { key: "nomeClinica", label: "Sua clínica", question: "Qual o nome da sua clínica?", type: "text", placeholder: "Nome da clínica", required: true, disqualify_values: [], db_column: "nome_empresa" },
];

type Props = {
  fields?: FieldDef[];
  preview?: boolean;
};

const QualificationForm = ({ fields: fieldsProp, preview = false }: Props) => {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [data, setData] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fields, setFields] = useState<FieldDef[]>(fieldsProp ?? []);
  const [ready, setReady] = useState(!!fieldsProp);

  useEffect(() => {
    if (fieldsProp) { setFields(fieldsProp); setReady(true); return; }
    supabase
      .from("qualification_fields" as any)
      .select("key,label,question,type,placeholder,options,required,disqualify_values,db_column,position,active")
      .eq("active", true)
      .order("position", { ascending: true })
      .then(({ data }) => {
        const list = (data ?? []) as any[];
        const mapped: FieldDef[] = list.map((r) => ({
          key: r.key,
          label: r.label,
          question: r.question,
          type: (r.type as FieldType) ?? "text",
          placeholder: r.placeholder,
          options: Array.isArray(r.options) ? r.options : [],
          required: !!r.required,
          disqualify_values: Array.isArray(r.disqualify_values) ? r.disqualify_values : [],
          db_column: r.db_column,
        }));
        setFields(mapped.length ? mapped : FALLBACK);
        setReady(true);
      });
  }, [fieldsProp]);

  const total = fields.length;
  const current = fields[step];
  const progress = total > 0 ? ((step + 1) / total) * 100 : 0;

  const schema = useMemo(() => {
    const shape: Record<string, z.ZodString> = {};
    for (const f of fields) {
      let s = z.string().trim().max(240);
      if (f.required) s = s.min(f.type === "tel" ? 14 : 2, "Campo obrigatório");
      if (f.type === "email") s = s.email("E-mail inválido");
      shape[f.key] = s;
    }
    return z.object(shape);
  }, [fields]);

  const setField = (key: string, value: string, type: FieldType) => {
    const v = type === "tel" ? maskPhone(value) : value;
    setData((d) => ({ ...d, [key]: v }));
    if (error) setError(null);
  };

  const validateStep = (): boolean => {
    if (!current) return false;
    const val = data[current.key] ?? "";
    if (current.required && val.trim().length === 0) {
      setError("Campo obrigatório");
      return false;
    }
    if (current.type === "tel" && val.length < 14) {
      setError("WhatsApp com DDD");
      return false;
    }
    return true;
  };

  const evaluateQualified = (form: Record<string, string>): boolean => {
    for (const f of fields) {
      const value = form[f.key];
      if (value && f.disqualify_values.includes(value)) return false;
    }
    return true;
  };

  const next = () => {
    if (!validateStep()) return;
    if (step < total - 1) setStep(step + 1);
    else submit();
  };

  const back = () => { if (step > 0) setStep(step - 1); };

  const submit = async () => {
    if (preview) { toast.success("Pré-visualização concluída"); return; }
    setLoading(true);
    try {
      const qualified = evaluateQualified(data);
      let utms: any = {};
      try {
        const raw = localStorage.getItem("posion_utms");
        if (raw) utms = JSON.parse(raw);
      } catch {}

      // Map answers: known db_column → column, else → extras jsonb
      const row: Record<string, any> = {
        status: qualified ? "novo" : "desqualificado",
        revendedor_iniciante: false,
        origem: utms.utm_source?.toLowerCase().includes("facebook") ? "facebook_ads" : "site",
        mql: qualified,
        utm_source: utms.utm_source ?? null,
        utm_medium: utms.utm_medium ?? null,
        utm_campaign: utms.utm_campaign ?? null,
        extras: {},
      };
      for (const f of fields) {
        const v = data[f.key];
        if (v === undefined) continue;
        if (f.db_column) row[f.db_column] = v;
        else row.extras[f.key] = v;
      }

      const { error } = await supabase.from("leads").insert(row as any);
      if (error) {
        toast.error("Erro ao enviar. Tente novamente.");
        console.error(error);
        return;
      }
      navigate("/obrigado");
    } finally {
      setLoading(false);
    }
  };

  if (!ready) {
    return (
      <div className="rounded-2xl border border-primary/20 bg-card/80 backdrop-blur-xl p-12 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }
  if (!current) {
    return (
      <div className="rounded-2xl border border-border bg-card/80 backdrop-blur-xl p-8 text-center text-muted-foreground">
        Formulário sem campos ativos.
      </div>
    );
  }

  const value = data[current.key] ?? "";

  return (
    <div className="relative rounded-2xl border border-primary/20 bg-card/90 backdrop-blur-xl p-6 md:p-8 shadow-[0_0_60px_-15px_hsl(var(--primary)/0.30)] animate-slide-up">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/12 border border-primary/30 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Diagnóstico</p>
            <p className="text-sm font-semibold text-foreground">{current.label}</p>
          </div>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums font-medium">
          {String(step + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
        </span>
      </div>

      <div className="h-1 w-full bg-secondary rounded-full overflow-hidden mb-7">
        <div
          className="h-full bg-gradient-to-r from-primary to-violet-400 transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      <h3 className="font-display text-2xl md:text-[1.75rem] text-foreground mb-6 leading-snug tracking-tight">
        {current.question}
      </h3>

      <div key={current.key} className="animate-fade-in-up">
        {current.type === "choice" ? (
          <div className="grid gap-2">
            {(current.options ?? []).map((opt) => {
              const selected = value === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => {
                    setField(current.key, opt, current.type);
                    setTimeout(() => {
                      if (step < total - 1) setStep((s) => s + 1);
                      else submit();
                    }, 180);
                  }}
                  className={`group flex items-center justify-between text-left px-4 py-3.5 rounded-xl border transition-all ${
                    selected
                      ? "border-primary/50 bg-primary/10 text-foreground"
                      : "border-border/60 bg-secondary/40 text-foreground/85 hover:border-primary/35 hover:bg-secondary/70"
                  }`}
                >
                  <span className="text-sm md:text-base">{opt}</span>
                  <CheckCircle2
                    className={`w-5 h-5 transition-opacity ${selected ? "opacity-100 text-primary" : "opacity-0"}`}
                  />
                </button>
              );
            })}
          </div>
        ) : (
          <Input
            autoFocus
            type={current.type === "email" ? "email" : current.type}
            placeholder={current.placeholder ?? undefined}
            value={value}
            onChange={(e) => setField(current.key, e.target.value, current.type)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); next(); }
            }}
            maxLength={current.type === "tel" ? 15 : 200}
            className="bg-background/60 border-border/60 focus:border-primary/60 text-base py-6 rounded-xl placeholder:text-muted-foreground/50"
          />
        )}
      </div>

      {error && <p className="text-sm text-destructive mt-3">{error}</p>}

      <div className="flex items-center justify-between mt-8">
        <Button
          type="button"
          variant="ghost"
          onClick={back}
          disabled={step === 0 || loading}
          className="text-muted-foreground hover:text-foreground gap-2 text-sm"
        >
          <ArrowLeft className="w-4 h-4" /> Voltar
        </Button>

        {current.type !== "choice" && (
          <Button
            type="button"
            onClick={next}
            disabled={loading}
            className="bg-gradient-to-r from-primary to-violet-500 hover:opacity-95 text-primary-foreground font-semibold gap-2 px-6 py-5 rounded-xl shadow-lg shadow-primary/20 transition-all hover:shadow-primary/35 hover:-translate-y-0.5"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {step === total - 1 ? "Enviar diagnóstico" : "Continuar"}
            {!loading && <ArrowRight className="w-4 h-4" />}
          </Button>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground/60 text-center mt-6 tracking-wide leading-relaxed">
        Vagas limitadas. Atendimento apenas para clínicas com fit estratégico.
      </p>
    </div>
  );
};

export default QualificationForm;
