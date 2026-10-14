/**
 * Grupos de sinônimos do vocabulário de brindes. É o "significado" da busca
 * enquanto o índice não tem embeddings: "copo" encontra caneca, "bloco"
 * encontra caderno.
 *
 * Cada grupo é simétrico. Casar por sinônimo vale menos que casar pela palavra
 * exata (ver PESO_SINONIMO em bm25.ts). A loja pode estender a lista sem mexer
 * na lógica.
 */
import { normalizar, radical } from "./texto.js";

export const GRUPOS_SINONIMOS: string[][] = [
  ["caneca", "copo", "xicara", "mug", "taca"],
  ["garrafa", "squeeze", "garrafinha", "cantil", "termo"],
  ["caderno", "bloco", "caderneta", "agenda", "anotacoes"],
  ["sacola", "ecobag", "bolsa", "sacochila"],
  ["caneta", "esferografica", "lapiseira"],
  ["camiseta", "camisa", "blusa"],
  ["mochila", "bolsa"],
  ["necessaire", "estojo", "nescessaire"],
  ["kit", "conjunto"],
  ["chaveiro", "chaveiros"],
  ["guardachuva", "sombrinha"],
  ["bone", "chapeu", "viseira"],
  ["fone", "headphone", "auricular", "headset"],
  ["carregador", "powerbank", "bateria"],
  ["pendrive", "flashdrive"],
  ["relogio", "cronometro"],
  ["almofada", "travesseiro"],
  ["toalha", "toalhinha"],
];

const mapa = new Map<string, Set<string>>();

for (const grupo of GRUPOS_SINONIMOS) {
  const radicais = grupo.map((p) => radical(normalizar(p)));
  for (const r of radicais) {
    const set = mapa.get(r) ?? new Set<string>();
    for (const outro of radicais) if (outro !== r) set.add(outro);
    mapa.set(r, set);
  }
}

/** Radicais equivalentes ao informado (sem incluir ele mesmo). */
export function sinonimosDe(radicalDoTermo: string): string[] {
  return [...(mapa.get(radicalDoTermo) ?? [])];
}
