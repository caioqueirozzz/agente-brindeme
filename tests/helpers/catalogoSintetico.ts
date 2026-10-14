import type { Product } from "../../src/integrations/brindeme/types.js";
import { produto, sub, type Faixa } from "./produtos.js";

/** Gerador pseudoaleatório determinístico: o mesmo catálogo em toda execução. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Tipo {
  nome: string;
  categoria: string;
  precoMin: number;
  precoMax: number;
  etiquetas: string[];
}

const TIPOS: Tipo[] = [
  { nome: "Caneca", categoria: "Canecas", precoMin: 8, precoMax: 25, etiquetas: ["natal", "corporativo", "dia-dos-professores", "aniversario"] },
  { nome: "Copo Long Drink", categoria: "Copos", precoMin: 6, precoMax: 20, etiquetas: ["eventos", "aniversario"] },
  { nome: "Squeeze", categoria: "Garrafas", precoMin: 10, precoMax: 30, etiquetas: ["esportivo", "corporativo", "dia-dos-pais"] },
  { nome: "Garrafa Térmica", categoria: "Garrafas", precoMin: 25, precoMax: 70, etiquetas: ["corporativo", "natal", "dia-dos-pais", "dia-das-maes"] },
  { nome: "Caderno", categoria: "Papelaria", precoMin: 6, precoMax: 30, etiquetas: ["dia-dos-professores", "volta-as-aulas", "corporativo", "formatura"] },
  { nome: "Caneta", categoria: "Papelaria", precoMin: 1, precoMax: 6, etiquetas: ["corporativo", "eventos", "formatura"] },
  { nome: "Agenda", categoria: "Papelaria", precoMin: 15, precoMax: 45, etiquetas: ["corporativo", "executivo", "natal"] },
  { nome: "Ecobag", categoria: "Bolsas", precoMin: 3, precoMax: 12, etiquetas: ["sustentabilidade", "eventos", "natal"] },
  { nome: "Mochila", categoria: "Bolsas", precoMin: 40, precoMax: 120, etiquetas: ["corporativo", "volta-as-aulas"] },
  { nome: "Necessaire", categoria: "Bolsas", precoMin: 10, precoMax: 35, etiquetas: ["dia-das-maes"] },
  { nome: "Chaveiro", categoria: "Acessórios", precoMin: 1, precoMax: 6, etiquetas: ["eventos", "natal"] },
  { nome: "Power Bank", categoria: "Eletrônicos", precoMin: 30, precoMax: 90, etiquetas: ["corporativo", "dia-dos-pais", "executivo"] },
  { nome: "Boné", categoria: "Vestuário", precoMin: 10, precoMax: 30, etiquetas: ["esportivo", "eventos"] },
  { nome: "Camiseta", categoria: "Vestuário", precoMin: 15, precoMax: 40, etiquetas: ["eventos", "esportivo"] },
  { nome: "Guarda-chuva", categoria: "Acessórios", precoMin: 25, precoMax: 60, etiquetas: ["corporativo"] },
  { nome: "Almofada", categoria: "Casa", precoMin: 15, precoMax: 45, etiquetas: ["dia-das-maes", "natal"] },
  { nome: "Toalha", categoria: "Casa", precoMin: 12, precoMax: 35, etiquetas: ["esportivo", "dia-dos-pais"] },
  { nome: "Kit Escritório", categoria: "Kits", precoMin: 50, precoMax: 200, etiquetas: ["executivo", "corporativo", "onboarding"] },
  { nome: "Kit Boas-Vindas", categoria: "Kits", precoMin: 60, precoMax: 220, etiquetas: ["onboarding", "corporativo"] },
];

const ADJETIVOS = ["Premium", "Eco", "Slim", "Clássico", "Compact", "Plus", "Mini", "Max"];
const CORES = ["Branco", "Preto", "Azul", "Vermelho", "Verde", "Prata", "Amarelo"];
const MINIMOS = [1, 10, 25, 50, 100, 200];

export function gerarCatalogo(n: number, seed = 42): Product[] {
  const rnd = mulberry32(seed);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
  const out: Product[] = [];

  for (let i = 0; i < n; i++) {
    const tipo = TIPOS[i % TIPOS.length];
    const min = pick(MINIMOS);
    const base = tipo.precoMin + rnd() * (tipo.precoMax - tipo.precoMin);

    const nTiers = 1 + Math.floor(rnd() * 3);
    const cortes = [min];
    for (let t = 1; t < nTiers; t++) cortes.push(cortes[t - 1] * (2 + Math.floor(rnd() * 3)));

    const nCores = 1 + Math.floor(rnd() * 3);
    const cores = [...CORES].sort(() => rnd() - 0.5).slice(0, nCores);
    const subprodutos = cores.map((cor, k) => {
      const faixas: Faixa[] = cortes.map((c, t) => [
        c,
        t === cortes.length - 1 ? 999_999 : cortes[t + 1] - 1,
        Math.round(base * (1 - 0.12 * t) * (1 + 0.05 * k) * 100) / 100,
      ]);
      // ~15% das cores sem estoque, o resto de poucas dezenas a milhares
      const estoque = rnd() < 0.15 ? 0 : Math.floor(Math.pow(rnd(), 2) * 5000);
      return sub(`p${i}-c${k}`, cor, estoque, faixas);
    });

    out.push(
      produto({
        id: `p${i}`,
        nome: `${tipo.nome} ${pick(ADJETIVOS)} ${i}`,
        categoria: tipo.categoria,
        min,
        destaque: rnd() < 0.1,
        ativo: rnd() > 0.05,
        subprodutos,
        etiquetas: tipo.etiquetas.filter(() => rnd() < 0.8),
        descricao: `${tipo.nome} para brindes, ideal para sua marca.`,
        atualizadoEm: "2026-10-10T00:00:00Z",
      })
    );
  }
  return out;
}
