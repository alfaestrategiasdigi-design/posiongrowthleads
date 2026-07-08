export function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function isGenericButtonArtifact(value: string): boolean {
  const key = stripDiacritics(value).toLowerCase().replace(/[^a-z0-9]/g, "");
  return key === "botao" || /^botaop[cps]*$/.test(key);
}

export function sanitizeButtonLabel(value: unknown, fallback: string): string {
  const text = String(value ?? "").replace(/[\u0000-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim();
  if (!text || isGenericButtonArtifact(text)) return fallback;
  return text.slice(0, 60);
}
