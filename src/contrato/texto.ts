import type { MensagemLote } from "./esquemas.js";

export const MAX_PARTES = 4;

export function loteParaTexto(mensagens: MensagemLote[]): string {
  return mensagens
    .map((m) => {
      const linhas: string[] = [];
      if (m.arquivo) {
        const kb = Math.max(1, Math.round(m.arquivo.bytes / 1024));
        linhas.push(`[ARQUIVO recebido: ${m.arquivo.nome} (${m.arquivo.mime}, ${kb} KB)]`);
      }
      if (m.texto.trim()) linhas.push(m.texto.trim());
      return linhas.join("\n");
    })
    .filter(Boolean)
    .join("\n");
}

export function formatarParaWhatsApp(texto: string): string[] {
  const convertido = texto
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/^#{1,6}[ \t]+(.+)$/gm, (_, titulo: string) => `*${titulo.replace(/\*/g, "")}*`);
  const paragrafos = convertido
    .split(/\n[ \t]*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paragrafos.length <= MAX_PARTES) return paragrafos;
  return [...paragrafos.slice(0, MAX_PARTES - 1), paragrafos.slice(MAX_PARTES - 1).join("\n\n")];
}
