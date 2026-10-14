/**
 * Normalização e tokenização compartilhadas pela busca de produtos e pela base
 * de conhecimento (Fase 3).
 *
 * Sem dependência externa: a busca roda em memória sobre o índice local. O
 * português é tratado com um radical leve (plural e poucos sufixos) — o
 * suficiente para "canecas" casar com "caneca" e "cores" com "cor", sem o
 * risco de um stemmer agressivo juntar palavras de sentidos diferentes.
 */

/** minúsculas, sem acento, só [a-z0-9] separados por um espaço. */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Palavras que não distinguem nada numa pergunta de cliente. Já normalizadas. */
const STOPWORDS = new Set(
  (
    "a o as os um uma uns umas de do da dos das em no na nos nas num numa por para pra pro com sem " +
    "e ou que qual quais quem como quando onde se ao aos eu voce voces vcs vc me te nos meu minha " +
    "meus minhas seu sua seus suas tem ter tenho temos quero queria queremos gostaria gostariamos " +
    "preciso precisamos algo alguma algum alguns algumas fazer faz fazem fazemos pode podem posso " +
    "podemos ser sao esta estao isso isto esse essa esses essas mais muito muitos ja ate cada sobre " +
    "entre so ha ai la aqui ola oi bom boa tudo tambem ainda mesmo depois antes agora hoje " +
    "vai vao vou favor obrigado obrigada ok"
  ).split(" ")
);

/**
 * Palavras que descrevem TODO produto da loja. Na busca de catálogo elas só
 * somam ruído: "brinde" aparece na descrição de metade do catálogo.
 */
const GENERICAS_DE_PRODUTO = new Set([
  "brinde", "brindes", "presente", "presentes", "lembranca", "lembrancas",
  "lembrancinha", "lembrancinhas", "mimo", "mimos", "personalizado", "personalizada",
  "personalizados", "personalizadas", "pessoa", "pessoas", "unidade", "unidades", "un",
  "reais", "real", "valor", "preco",
]);

/**
 * Radical leve do português. Aplicado igual na indexação e na consulta, então
 * a regra só precisa ser consistente — não linguisticamente perfeita.
 */
export function radical(token: string): string {
  const t = token;
  if (t.length <= 3) return t;
  if (t.endsWith("oes")) return t.slice(0, -3) + "ao"; // botoes → botao
  if (t.endsWith("ais")) return t.slice(0, -3) + "al"; // animais → animal
  if (t.endsWith("eis")) return t.slice(0, -3) + "el"; // papeis → papel
  if (t.endsWith("ns")) return t.slice(0, -2) + "m"; // itens → item
  if (t.endsWith("res")) return t.slice(0, -2); // cores → cor
  if (t.endsWith("s") && !t.endsWith("ss") && !t.endsWith("us") && !t.endsWith("is")) {
    return t.slice(0, -1); // canecas → caneca
  }
  return t;
}

export interface OpcoesTokenizar {
  /** Remove também as palavras genéricas de produto (só na consulta de catálogo). */
  semGenericasDeProduto?: boolean;
}

export function tokenizar(texto: string, opcoes?: OpcoesTokenizar): string[] {
  const out: string[] = [];
  for (const bruto of normalizar(texto).split(" ")) {
    if (!bruto) continue;
    if (STOPWORDS.has(bruto)) continue;
    if (opcoes?.semGenericasDeProduto && GENERICAS_DE_PRODUTO.has(bruto)) continue;
    // Um caractere só é ruído, exceto número ("5 canecas" é informação).
    if (bruto.length < 2 && !/\d/.test(bruto)) continue;
    out.push(radical(bruto));
  }
  return out;
}

/** Remove tags HTML (a API manda <b>, <br/> em tech_description e às vezes em description). */
export function removerHtml(texto: string): string {
  return texto
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}
