export type KanbanDensity = "compact" | "comfortable" | "spacious";

export const DENSITY_STORAGE_KEY = "posion.kanban.density";

export function readDensity(): KanbanDensity {
  if (typeof window === "undefined") return "comfortable";
  try {
    const v = window.localStorage.getItem(DENSITY_STORAGE_KEY);
    if (v === "compact" || v === "comfortable" || v === "spacious") return v;
  } catch {}
  return "comfortable";
}

export function writeDensity(d: KanbanDensity) {
  try {
    window.localStorage.setItem(DENSITY_STORAGE_KEY, d);
  } catch {}
}
