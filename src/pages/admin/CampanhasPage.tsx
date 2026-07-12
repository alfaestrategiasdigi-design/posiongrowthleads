import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Building2, Search, ChevronRight, Settings2 } from "lucide-react";
import TenantCampaigns from "@/pages/app/TenantCampaigns";

const MASTER_TENANT_ID = "00000000-0000-0000-0000-000000000001";

type TenantRow = {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  status: string;
};

function TenantPicker() {
  const navigate = useNavigate();
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("tenants")
        .select("id, slug, name, logo_url, status")
        .neq("id", MASTER_TENANT_ID)
        .order("name");
      setTenants((data as TenantRow[]) || []);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return tenants;
    return tenants.filter(t => t.name.toLowerCase().includes(s) || t.slug.toLowerCase().includes(s));
  }, [tenants, q]);

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Marketing · Meta Ads</div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Building2 className="w-7 h-7 text-primary" />
            Campanhas · Selecionar Clínica
          </h1>
          <p className="text-sm text-muted-foreground">
            Escolha uma clínica para abrir o dashboard de campanhas com o mesmo layout do painel do tenant.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => navigate("/admin/facebook")}>
          <Settings2 className="w-4 h-4 mr-2" /> Configuração Meta / Gestão global
        </Button>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar clínica por nome ou slug..."
          className="pl-9"
        />
      </div>

      {loading ? (
        <div className="text-muted-foreground text-sm">Carregando clínicas...</div>
      ) : filtered.length === 0 ? (
        <div className="text-muted-foreground text-sm">Nenhuma clínica encontrada.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((t) => (
            <button
              key={t.id}
              onClick={() => navigate(`/admin/campanhas/${t.slug}`)}
              className="group text-left"
            >
              <Card className="p-4 flex items-center gap-3 hover:border-primary/60 transition-colors">
                <div className="w-10 h-10 rounded-full bg-muted overflow-hidden flex items-center justify-center shrink-0">
                  {t.logo_url ? (
                    <img src={t.logo_url} alt={t.name} className="w-full h-full object-cover" />
                  ) : (
                    <Building2 className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{t.name}</div>
                  <div className="text-xs text-muted-foreground truncate">/{t.slug}</div>
                </div>
                <Badge variant={t.status === "active" ? "default" : "outline"} className="text-[10px]">
                  {t.status}
                </Badge>
                <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
              </Card>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CampanhasPage() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const navigate = useNavigate();

  if (!tenantSlug) return <TenantPicker />;

  return (
    <div>
      <div className="px-6 pt-4 flex items-center gap-2 text-xs">
        <button onClick={() => navigate("/admin/campanhas")} className="text-muted-foreground hover:text-foreground">
          ← Trocar clínica
        </button>
      </div>
      <TenantCampaigns />
    </div>
  );
}
