import { z } from "zod";

export const LIMITE_TEXTO = 4_000;
export const MAX_MENSAGENS_LOTE = 10;

const telefone = z.string().regex(/^\d{10,15}$/, "telefone só com dígitos, com DDI");
const timestamp = z.string().datetime();

export const arquivoSchema = z.object({
  caminho: z.string().min(1),
  mime: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  nome: z.string().min(1),
});

export const mensagemLoteSchema = z.object({
  id: z.string().min(1),
  timestamp,
  texto: z.string().max(LIMITE_TEXTO),
  arquivo: arquivoSchema.optional(),
});

export const pedidoMensagensSchema = z.object({
  turnoId: z.string().regex(/^[0-9a-f]{16}$/),
  telefone,
  mensagens: z.array(mensagemLoteSchema).min(1).max(MAX_MENSAGENS_LOTE),
});

export const modoSchema = z.enum(["ia", "humano"]);

export const respostaMensagensSchema = z.object({
  respostas: z.array(z.string()),
  avisoAtendente: z.string().optional(),
  modo: modoSchema,
});

export const eventoSchema = z.discriminatedUnion("tipo", [
  z.object({
    tipo: z.literal("mensagem_atendente"),
    telefone,
    id: z.string().min(1),
    texto: z.string(),
    timestamp,
  }),
  z.object({
    tipo: z.literal("devolver"),
    telefone,
    nota: z.string().max(500).optional(),
  }),
]);

export const respostaEventoSchema = z.object({ modo: modoSchema });

export type Arquivo = z.infer<typeof arquivoSchema>;
export type MensagemLote = z.infer<typeof mensagemLoteSchema>;
export type PedidoMensagens = z.infer<typeof pedidoMensagensSchema>;
export type Modo = z.infer<typeof modoSchema>;
export type RespostaMensagens = z.infer<typeof respostaMensagensSchema>;
export type Evento = z.infer<typeof eventoSchema>;
export type RespostaEvento = z.infer<typeof respostaEventoSchema>;
