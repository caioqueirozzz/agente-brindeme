import { z } from "zod";
import type { ConversationState } from "../agent/state.js";
import type { BrindeMeClient } from "../integrations/brindeme/client.js";

/** Fatos guardados por conversa: os mais antigos saem primeiro. */
export const MAX_FATOS_MEMORIA = 15;

export const registrarContextoSchema = z.object({
  tipo_cliente: z
    .enum(["PF", "PJ"])
    .optional()
    .describe("PJ quando compra para empresa (CNPJ, brinde corporativo, evento da empresa); PF quando compra para si ou como pessoa física"),
  nome: z.string().max(80).optional().describe("Nome pelo qual o cliente se apresentou ou pediu para ser chamado"),
  empresa: z.string().max(120).optional().describe("Nome da empresa do cliente, quando ele disser"),
  ocasiao: z.string().max(120).optional().describe("Ocasião do pedido (confraternização, evento, Natal, onboarding, presente...)"),
  fato: z
    .string()
    .max(200)
    .optional()
    .describe("Uma informação que o cliente contou e vale lembrar depois, em uma frase curta (ex.: 'evento é para 80 colaboradores em 12/12', 'prefere tons de azul', 'já comprou canecas antes')"),
});

export type RegistrarContextoInput = z.infer<typeof registrarContextoSchema>;

/**
 * Memória contextual da conversa. Não fala com a loja: só grava no estado o que o cliente contou,
 * e o estado volta ao prompt em todo turno — inclusive quando a mensagem original já saiu da janela.
 */
export async function registrarContextoHandler(
  input: RegistrarContextoInput,
  state: ConversationState,
  _client: BrindeMeClient
) {
  const registrado: string[] = [];
  if (input.tipo_cliente) {
    state.cliente.tipo = input.tipo_cliente;
    registrado.push("tipo_cliente");
  }
  const nome = input.nome?.trim();
  if (nome) {
    state.cliente.nome = nome;
    registrado.push("nome");
  }
  const empresa = input.empresa?.trim();
  if (empresa) {
    state.cliente.empresa = empresa;
    registrado.push("empresa");
  }
  const ocasiao = input.ocasiao?.trim();
  if (ocasiao) {
    state.necessidade.ocasiao = ocasiao;
    registrado.push("ocasiao");
  }
  const fato = input.fato?.trim();
  if (fato) {
    const memoria = (state.memoria ??= { fatos: [] });
    // Turno repetido depois de falha chama a ferramenta de novo: o mesmo fato não entra duas vezes
    if (!memoria.fatos.some((f) => f.toLowerCase() === fato.toLowerCase())) {
      memoria.fatos.push(fato);
      if (memoria.fatos.length > MAX_FATOS_MEMORIA) memoria.fatos.splice(0, memoria.fatos.length - MAX_FATOS_MEMORIA);
    }
    registrado.push("fato");
  }
  return registrado.length > 0 ? { status: "contexto_registrado", registrado } : { status: "nada_para_registrar" };
}
