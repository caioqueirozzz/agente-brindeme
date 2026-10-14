/**
 * Lacunas da base de conhecimento (Fase 3): perguntas que o cliente fez e a
 * base não soube responder. Viram a fila de trabalho da loja — o que mais
 * aparece aqui é o próximo item a escrever e aprovar.
 *
 * Guarda a pergunta mascarada (telefone, e-mail e CPF) e o id da conversa; nada
 * além disso.
 */
import { appendFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { tokenizar } from "../busca/texto.js";
import { mascararTexto } from "../logging/logger.js";

const __dir = dirname(fileURLToPath(import.meta.url));

export interface Lacuna {
  pergunta: string;
  conversa_id: string;
  /** Categoria que o modelo achou mais provável, se informou. */
  categoria_sugerida?: string;
  registrado_em: string;
}

export interface LacunaStore {
  registrar(lacuna: Lacuna): void;
  listar(): Lacuna[];
}

const LIMITE_PERGUNTA = 300;

export function criarLacuna(
  pergunta: string,
  conversaId: string,
  categoriaSugerida?: string,
  agora = new Date()
): Lacuna {
  return {
    pergunta: mascararTexto(pergunta).slice(0, LIMITE_PERGUNTA),
    conversa_id: conversaId,
    categoria_sugerida: categoriaSugerida,
    registrado_em: agora.toISOString(),
  };
}

export class MemoryLacunaStore implements LacunaStore {
  private readonly itens: Lacuna[] = [];
  registrar(l: Lacuna): void {
    this.itens.push(l);
  }
  listar(): Lacuna[] {
    return [...this.itens];
  }
}

/** Um registro por linha (JSONL): anexar é atômico o bastante para vários processos. */
export class FileLacunaStore implements LacunaStore {
  constructor(private readonly file = join(__dir, "../../data/lacunas.jsonl")) {}

  registrar(l: Lacuna): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      appendFileSync(this.file, JSON.stringify(l) + "\n", "utf-8");
    } catch {
      // Registrar lacuna não pode derrubar o atendimento.
    }
  }

  listar(): Lacuna[] {
    if (!existsSync(this.file)) return [];
    const out: Lacuna[] = [];
    for (const linha of readFileSync(this.file, "utf-8").split("\n")) {
      if (!linha.trim()) continue;
      try {
        out.push(JSON.parse(linha) as Lacuna);
      } catch {
        // linha truncada: ignora
      }
    }
    return out;
  }
}

export interface LacunaAgrupada {
  pergunta_exemplo: string;
  ocorrencias: number;
  conversas: number;
  ultima_em: string;
  categoria_sugerida?: string;
}

/**
 * Junta perguntas parecidas ("qual o CNPJ de vocês?" / "me passa o cnpj da
 * loja") pelas palavras que sobram depois de tirar as vazias.
 */
export function agruparLacunas(lacunas: Lacuna[]): LacunaAgrupada[] {
  const grupos = new Map<string, { itens: Lacuna[] }>();
  for (const l of lacunas) {
    const chave = [...new Set(tokenizar(l.pergunta))].sort().join(" ") || l.pergunta.toLowerCase();
    const g = grupos.get(chave) ?? { itens: [] };
    g.itens.push(l);
    grupos.set(chave, g);
  }
  return [...grupos.values()]
    .map(({ itens }) => {
      const ultima = itens.reduce((a, b) => (a.registrado_em > b.registrado_em ? a : b));
      return {
        pergunta_exemplo: ultima.pergunta,
        ocorrencias: itens.length,
        conversas: new Set(itens.map((i) => i.conversa_id)).size,
        ultima_em: ultima.registrado_em,
        categoria_sugerida: itens.find((i) => i.categoria_sugerida)?.categoria_sugerida,
      };
    })
    .sort((a, b) => b.ocorrencias - a.ocorrencias || (a.ultima_em < b.ultima_em ? 1 : -1));
}
