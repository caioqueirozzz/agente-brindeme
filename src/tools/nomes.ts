/**
 * Nomes das ferramentas do agente, sem importar os handlers: a ponte usa a lista para
 * validar #desligar/#religar sem carregar catálogo, base de conhecimento e cliente da API.
 * tests/homologacao/seguranca.test.ts confere que bate com tools/index.ts.
 */
export const NOMES_FERRAMENTAS = [
  "consultar_conhecimento",
  "buscar_produtos",
  "detalhar_produto",
  "preparar_orcamento",
  "criar_orcamento",
  "consultar_orcamento",
  "consultar_pedido",
  "registrar_arte",
  "transferir_humano",
] as const;

export function ehFerramenta(nome: string): boolean {
  return (NOMES_FERRAMENTAS as readonly string[]).includes(nome);
}
