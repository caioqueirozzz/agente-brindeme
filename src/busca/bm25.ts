/**
 * Índice BM25 em memória, usado pelo catálogo de produtos e pela base de
 * conhecimento. Genérico de propósito: recebe documentos com campos ponderados
 * (o nome vale mais que a descrição) e devolve, por documento, a pontuação e a
 * COBERTURA da consulta.
 *
 * A cobertura é o que protege contra resposta errada: "quantos dias fica
 * pronto?" não pode responder com um item que só casa com "dias". Quem usa o
 * índice decide o corte.
 */

const K1 = 1.2;
const B = 0.75;
/** Quanto vale casar por sinônimo em relação à palavra exata. */
export const PESO_SINONIMO = 0.7;

export interface CampoBusca {
  /** Tokens já normalizados e com radical. */
  tokens: string[];
  peso: number;
}

export interface DocumentoBusca {
  id: string;
  campos: CampoBusca[];
}

export interface TermoConsulta {
  /** Radical do termo. */
  termo: string;
  /** Radicais equivalentes (sinônimos). */
  alternativas: string[];
}

export interface PontuacaoDocumento {
  score: number;
  /** Fração do "peso informativo" da consulta que o documento cobre, 0..1. */
  cobertura: number;
  /** Termos da consulta que casaram (exato ou sinônimo). */
  casados: string[];
}

interface DocInterno {
  id: string;
  tf: Map<string, number>;
  comprimento: number;
}

export class IndiceBM25 {
  private readonly docs: DocInterno[];
  private readonly df = new Map<string, number>();
  private readonly mediaComprimento: number;

  constructor(documentos: DocumentoBusca[]) {
    this.docs = documentos.map((d) => {
      const tf = new Map<string, number>();
      let comprimento = 0;
      for (const campo of d.campos) {
        for (const t of campo.tokens) {
          tf.set(t, (tf.get(t) ?? 0) + campo.peso);
          comprimento += campo.peso;
        }
      }
      return { id: d.id, tf, comprimento };
    });

    for (const d of this.docs) for (const t of d.tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);

    const total = this.docs.reduce((acc, d) => acc + d.comprimento, 0);
    this.mediaComprimento = this.docs.length ? total / this.docs.length : 1;
  }

  get tamanho(): number {
    return this.docs.length;
  }

  /** IDF de Robertson–Sparck Jones com piso positivo. Termo desconhecido tem o IDF máximo. */
  idf(termo: string): number {
    const n = this.df.get(termo) ?? 0;
    const N = this.docs.length;
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  }

  /** `idfDe` é o termo cujo peso vale: o sinônimo pesa o que pesa a palavra pedida. */
  private parcela(doc: DocInterno, termo: string, idfDe = termo): number {
    const tf = doc.tf.get(termo);
    if (!tf) return 0;
    const norm = 1 - B + B * (doc.comprimento / (this.mediaComprimento || 1));
    return this.idf(idfDe) * ((tf * (K1 + 1)) / (tf + K1 * norm));
  }

  pontuar(consulta: TermoConsulta[]): Map<string, PontuacaoDocumento> {
    const resultado = new Map<string, PontuacaoDocumento>();
    if (consulta.length === 0) return resultado;

    const pesoTotal = consulta.reduce((acc, t) => acc + this.idf(t.termo), 0) || 1;

    for (const doc of this.docs) {
      let score = 0;
      let coberto = 0;
      const casados: string[] = [];

      for (const t of consulta) {
        const exato = this.parcela(doc, t.termo);
        let melhorAlternativa = 0;
        for (const alt of t.alternativas) {
          // Com o IDF do próprio sinônimo, a rara "xicara" passava na frente da "caneca" pedida (#26).
          melhorAlternativa = Math.max(melhorAlternativa, this.parcela(doc, alt, t.termo) * PESO_SINONIMO);
        }
        // Max, não soma: o mesmo conceito não conta duas vezes.
        const contribuicao = Math.max(exato, melhorAlternativa);
        if (contribuicao > 0) {
          score += contribuicao;
          coberto += this.idf(t.termo);
          casados.push(t.termo);
        }
      }

      if (score > 0) {
        resultado.set(doc.id, { score, cobertura: coberto / pesoTotal, casados });
      }
    }
    return resultado;
  }
}
