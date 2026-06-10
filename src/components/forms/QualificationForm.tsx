import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { maskPhone } from "@/lib/masks";
import { toast } from "sonner";

const especialidadeOptions = [
  "Odontologia", "Estética", "Dermatologia", "Cirurgia Plástica",
  "Transplante Capilar", "Fisioterapia", "Oftalmologia", "Nutrição", "Outro",
];
const numProfissionaisOptions = ["1", "2 a 5", "6 a 10", "Acima de 10"];
const investiuTrafegoOptions = [
  "Nunca investi",
  "Já investi por conta própria",
  "Já contratei uma agência no passado",
  "Faço tráfego internamente",
  "Tenho agência atualmente",
];
const faturamentoOptions = [
  "Abaixo de R$10 mil",
  "R$10 mil a R$30 mil",
  "R$31 mil a R$50 mil",
  "R$51 mil a R$100 mil",
  "R$101 mil a R$300 mil",
  "Acima de R$300 mil",
];

type FormData = {
  nomeCompleto: string;
  whatsapp: string;
  email: string;
  nomeClinica: string;
  cidadeEstado: string;
  especialidade: string;
  numProfissionais: string;
  investiuTrafego: string;
  faturamentoMensal: string;
};

const schema = z.object({
  nomeCompleto: z.string().trim().min(3, "Informe seu nome").max(120),
  whatsapp: z.string().min(14, "WhatsApp com DDD").max(20),
  email: z.string().trim().email("E-mail inválido").max(160),
  nomeClinica: z.string().trim().min(2, "Informe o nome da clínica").max(120),
  cidadeEstado: z.string().trim().min(2, "Informe cidade / UF").max(120),
  especialidade: z.string().min(1, "Selecione a especialidade"),
  numProfissionais: z.string().min(1, "Selecione uma opção"),
  investiuTrafego: z.string().min(1, "Selecione uma opção"),
  faturamentoMensal: z.string().min(1, "Selecione uma opção"),
});

type Criterion = { field: keyof FormData; label: string; disqualify_values: string[]; active: boolean };

type Step = {
  field: keyof FormData;
  label: string;
  question: string;
  type: "text" | "tel" | "email" | "choice";
  placeholder?: string;
  options?: string[];
};

const steps: Step[] = [
  { field: "nomeCompleto", label: "Quem é você", question: "Qual o seu nome?", type: "text", placeholder: "Nome do responsável (médico/gestor)" },
  { field: "whatsapp", label: "Contato", question: "Qual seu WhatsApp com DDD?", type: "tel", placeholder: "(00) 00000-0000" },
  { field: "email", label: "E-mail", question: "Em qual e-mail podemos te chamar?", type: "email", placeholder: "seu@email.com" },
  { field: "nomeClinica", label: "Sua clínica", question: "Qual o nome da sua clínica?", type: "text", placeholder: "Nome da clínica" },
  { field: "cidadeEstado", label: "Localização", question: "Cidade e estado?", type: "text", placeholder: "Cidade, UF" },
  { field: "especialidade", label: "Especialidade", question: "Qual é a sua especialidade ou nicho?", type: "choice", options: especialidadeOptions },
  { field: "numProfissionais", label: "Equipe", question: "Quantos profissionais atendem na clínica?", type: "choice", options: numProfissionaisOptions },
  { field: "investiuTrafego", label: "Tráfego", question: "Você já investiu em tráfego pago?", type: "choice", options: investiuTrafegoOptions },
  { field: "faturamentoMensal", label: "Faturamento", question: "Qual o faturamento mensal atual?", type: "choice", options: faturamentoOptions },
];

const initial: FormData = {
  nomeCompleto: "", whatsapp: "", email: "", nomeClinica: "",
  cidadeEstado: "", especialidade: "", numProfissionais: "",
  investiuTrafego: "", faturamentoMensal: "",
};

const fieldDbMap: Record<keyof FormData, string> = {
  nomeCompleto: "nome_completo",
  whatsapp: "whatsapp",
  email: "email",
  nomeClinica: "nome_empresa",
  cidadeEstado: "cidade_estado",
  especialidade: "especialidade",
  numProfissionais: "num_profissionais",
  investiuTrafego: "investiu_trafego",
  faturamentoMensal: "faturamento_mensal",
};

const QualificationForm = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [data, setData] = useState<FormData>(initial);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [criteria, setCriteria] = useState<Criterion[]>([]);

  useEffect(() => {
    supabase
      .from("qualification_criteria")
      .select("field, label, disqualify_values, active")
      .eq("active", true)
      .then(({ data }) => {
        if (data) setCriteria(data as unknown as Criterion[]);
      });
  }, []);

  const total = steps.length;
  const current = steps[step];
  const progress = ((step + 1) / total) * 100;

  const setField = (field: keyof FormData, value: string) => {
    const v = field === "whatsapp" ? maskPhone(value) : value;
    setData((d) => ({ ...d, [field]: v }));
    if (error) setError(null);
  };

  const validateStep = (): boolean => {
    const value = data[current.field];
    const sub = schema.pick({ [current.field]: true } as any);
    const result = sub.safeParse({ [current.field]: value });
    if (!result.success) {
      setError(result.error.errors[0]?.message ?? "Campo inválido");
      return false;
    }
    return true;
  };

  const evaluateQualified = (form: FormData): boolean => {
    for (const c of criteria) {
      if (!c.active) continue;
      const value = form[c.field];
      if (value && Array.isArray(c.disqualify_values) && c.disqualify_values.includes(value)) {
        return false;
      }
    }
    return true;
  };

  const next = () => {
    if (!validateStep()) return;
    if (step < total - 1) setStep(step + 1);
    else submit();
  };

  const back = () => {
    if (step > 0) setStep(step - 1);
  };

  const submit = async () => {
    setLoading(true);
    try {
      const parsed = schema.parse(data);
      const qualified = evaluateQualified(parsed as FormData);

      // Recuperar UTMs salvos do tracking
      let utms: any = {};
      try {
        const raw = localStorage.getItem("posion_utms");
        if (raw) utms = JSON.parse(raw);
      } catch {}

      const { error } = await supabase.from("leads").insert({
        nome_completo: parsed.nomeCompleto,
        whatsapp: parsed.whatsapp,
        email: parsed.email,
        nome_empresa: parsed.nomeClinica,
        cidade_estado: parsed.cidadeEstado,
        especialidade: parsed.especialidade,
        num_profissionais: parsed.numProfissionais,
        investiu_trafego: parsed.investiuTrafego,
        faturamento_mensal: parsed.faturamentoMensal,
        status: qualified ? "novo" : "desqualificado",
        revendedor_iniciante: false,
        origem: utms.utm_source?.toLowerCase().includes("facebook") ? "facebook_ads" : "site",
        mql: qualified,
        utm_source: utms.utm_source ?? null,
        utm_medium: utms.utm_medium ?? null,
        utm_campaign: utms.utm_campaign ?? null,
      } as any);
      if (error) {
        toast.error("Erro ao enviar. Tente novamente.");
        console.error(error);
        return;
      }
      navigate("/obrigado");
    } catch (e) {
      if (e instanceof z.ZodError) setError(e.errors[0]?.message ?? "Verifique os dados");
    } finally {
      setLoading(false);
    }
  };

  const value = data[current.field];

  return (
    <div className="card-elevated p-6 md:p-8 animate-slide-up">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-accent/10 border border-accent/30 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-accent" />
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Diagnóstico</p>
            <p className="text-sm font-semibold text-foreground">{current.label}</p>
          </div>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {String(step + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
        </span>
      </div>

      {/* Progress */}
      <div className="h-1 w-full bg-secondary rounded-full overflow-hidden mb-7">
        <div
          className="h-full gradient-accent transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Question */}
      <h3 className="font-display text-2xl md:text-3xl text-foreground mb-6 leading-snug">
        {current.question}
      </h3>

      {/* Input */}
      <div key={current.field} className="animate-fade-in-up">
        {current.type === "choice" ? (
          <div className="grid gap-2">
            {current.options!.map((opt) => {
              const selected = value === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => {
                    setField(current.field, opt);
                    setTimeout(() => {
                      if (step < total - 1) setStep((s) => s + 1);
                      else submit();
                    }, 180);
                  }}
                  className={`group flex items-center justify-between text-left px-4 py-3.5 rounded-xl border transition-all ${
                    selected
                      ? "border-accent bg-accent/10 text-foreground"
                      : "border-border bg-secondary/60 text-foreground/85 hover:border-accent/50 hover:bg-secondary"
                  }`}
                >
                  <span className="text-sm md:text-base">{opt}</span>
                  <CheckCircle2
                    className={`w-5 h-5 transition-opacity ${selected ? "opacity-100 text-accent" : "opacity-0"}`}
                  />
                </button>
              );
            })}
          </div>
        ) : (
          <Input
            autoFocus
            type={current.type}
            placeholder={current.placeholder}
            value={value}
            onChange={(e) => setField(current.field, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                next();
              }
            }}
            maxLength={current.type === "tel" ? 15 : 160}
            className="bg-secondary border-border focus:border-accent text-base py-6"
          />
        )}
      </div>

      {error && <p className="text-sm text-destructive mt-3">{error}</p>}

      {/* Nav */}
      <div className="flex items-center justify-between mt-8">
        <Button
          type="button"
          variant="ghost"
          onClick={back}
          disabled={step === 0 || loading}
          className="text-muted-foreground hover:text-foreground gap-2"
        >
          <ArrowLeft className="w-4 h-4" /> Voltar
        </Button>

        {current.type !== "choice" && (
          <Button
            type="button"
            onClick={next}
            disabled={loading}
            className="gradient-accent hover:opacity-90 text-primary-foreground font-semibold gap-2 px-6 py-5 rounded-xl btn-glow"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {step === total - 1 ? "Enviar diagnóstico" : "Continuar"}
            {!loading && <ArrowRight className="w-4 h-4" />}
          </Button>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground/70 text-center mt-6 tracking-wide">
        Vagas limitadas. Atendimento apenas para clínicas com fit estratégico.
      </p>
    </div>
  );
};

export default QualificationForm;