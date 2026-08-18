import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

/** Converte qualquer valor em Date válido — ou null. Nunca lança. */
export function toDate(value: unknown): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return isNaN(d.getTime()) ? null : d;
}

/** format() blindado: datas inválidas viram null em vez de derrubar a tela. */
export function safeFormat(value: unknown, pattern: string): string | null {
  const d = toDate(value);
  if (!d) return null;
  try {
    return format(d, pattern, { locale: ptBR });
  } catch {
    return null;
  }
}

/** formatDistanceToNow() blindado. */
export function safeDistance(value: unknown): string | null {
  const d = toDate(value);
  if (!d) return null;
  try {
    return formatDistanceToNow(d, { addSuffix: true, locale: ptBR });
  } catch {
    return null;
  }
}
