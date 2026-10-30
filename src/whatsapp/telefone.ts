export function normalizarTelefone(entrada: string): string {
  const d = entrada.replace(/\D/g, "");
  if (d.startsWith("55") && d.length === 12 && /[6-9]/.test(d.charAt(4))) {
    return `${d.slice(0, 4)}9${d.slice(4)}`;
  }
  return d;
}

export function ehConversaDireta(chatId: string, author?: string | null): boolean {
  const jid = chatId.trim().toLowerCase();
  if (!jid || author) return false;
  if (jid === "status@broadcast") return false;
  return jid.endsWith("@c.us") || jid.endsWith("@lid");
}
