/**
 * Envia as conversas gravadas pelo agente (data/conversas/*.json) para o CRM.
 *   npm run sync:agente                 # uma vez
 *   npm run sync:agente -- --seguir     # fica de olho e reenvia o que mudar
 *
 * Variáveis: CRM_URL (padrão http://localhost:3200), CRM_INTEGRATION_SECRET,
 * CONVERSAS_DIR (padrão ../data/conversas, a pasta do agente).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const CRM_URL = (process.env.CRM_URL || "http://localhost:3200").replace(/\/$/, "");
const SECRET = process.env.CRM_INTEGRATION_SECRET;
const DIR = resolve(process.env.CONVERSAS_DIR || "../data/conversas");
const FOLLOW = process.argv.includes("--seguir");
const INTERVAL_MS = 15_000;

if (!SECRET) {
  console.error("Defina CRM_INTEGRATION_SECRET (o mesmo do .env do CRM).");
  process.exit(1);
}

const sent = new Map<string, number>();

async function once() {
  let files: string[];
  try {
    files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
  } catch {
    console.error(`Pasta de conversas não encontrada: ${DIR}`);
    return;
  }
  const changed = files.filter((f) => {
    const mtime = statSync(join(DIR, f)).mtimeMs;
    if (sent.get(f) === mtime) return false;
    sent.set(f, mtime);
    return true;
  });
  if (changed.length === 0) return;

  for (let i = 0; i < changed.length; i += 50) {
    const batch = changed.slice(i, i + 50).flatMap((f) => {
      try {
        return [JSON.parse(readFileSync(join(DIR, f), "utf8"))];
      } catch {
        console.warn(`Ignorado (JSON inválido): ${f}`);
        return [];
      }
    });
    const res = await fetch(`${CRM_URL}/api/integracao/conversas`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-crm-secret": SECRET! },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      console.error(`CRM respondeu ${res.status}: ${await res.text()}`);
      changed.slice(i, i + 50).forEach((f) => sent.delete(f));
      continue;
    }
    const { results } = (await res.json()) as { results: Array<{ ok: boolean; created?: boolean; newMessages?: number; error?: string }> };
    const ok = results.filter((r) => r.ok);
    console.log(
      `${new Date().toLocaleTimeString("pt-BR")} · ${ok.length} conversa(s) · ${ok.filter((r) => r.created).length} lead(s) novo(s) · ${ok.reduce((s, r) => s + (r.newMessages ?? 0), 0)} mensagem(ns) nova(s)` +
        (results.length > ok.length ? ` · ${results.length - ok.length} com erro` : "")
    );
  }
}

await once();
if (FOLLOW) {
  console.log(`Acompanhando ${DIR} a cada ${INTERVAL_MS / 1000}s…`);
  setInterval(() => once().catch((e) => console.error(e)), INTERVAL_MS);
}
