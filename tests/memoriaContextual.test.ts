import { describe, expect, it } from "vitest";
import { createInitialState, limparNomeWhatsapp, type Mensagem } from "../src/agent/state.js";
import { momentoDaConversa } from "../src/agent/runTurn.js";
import { MAX_FATOS_MEMORIA, registrarContextoHandler } from "../src/tools/registrarContexto.js";
import type { BrindeMeClient } from "../src/integrations/brindeme/client.js";

const semCliente = {} as BrindeMeClient;

function msg(role: Mensagem["role"], timestamp: string): Mensagem {
  return { role, content: "x", timestamp };
}

describe("nome do WhatsApp", () => {
  it("tira emoji e símbolo e mantém acento", () => {
    expect(limparNomeWhatsapp("  João 🚀  Silva ")).toBe("João Silva");
    expect(limparNomeWhatsapp("Ana-Clara D'Ávila")).toBe("Ana-Clara D'Ávila");
  });

  it("perfil sem nome de verdade não vira cumprimento", () => {
    expect(limparNomeWhatsapp("🙂🙂")).toBeUndefined();
    expect(limparNomeWhatsapp("+55 83 9999")).toBeUndefined();
    expect(limparNomeWhatsapp(".")).toBeUndefined();
    expect(limparNomeWhatsapp(undefined)).toBeUndefined();
  });
});

describe("momento da conversa", () => {
  it("início enquanto a assistente não falou", () => {
    expect(momentoDaConversa([msg("user", "2026-10-30T12:00:00Z")])).toBe("inicio");
  });

  it("andamento logo depois da resposta", () => {
    const h = [msg("user", "2026-10-30T12:00:00Z"), msg("assistant", "2026-10-30T12:00:05Z"), msg("user", "2026-10-30T12:03:00Z")];
    expect(momentoDaConversa(h)).toBe("andamento");
  });

  it("retorno depois de horas em silêncio", () => {
    const h = [msg("user", "2026-10-29T12:00:00Z"), msg("assistant", "2026-10-29T12:00:05Z"), msg("user", "2026-10-30T09:00:00Z")];
    expect(momentoDaConversa(h)).toBe("retorno");
  });
});

describe("registrar_contexto", () => {
  it("grava tipo, nome, empresa, ocasião e fato no estado", async () => {
    const estado = createInitialState("5583999990000");
    const r = await registrarContextoHandler(
      { tipo_cliente: "PJ", nome: "Ana", empresa: "Acme", ocasiao: "confraternização", fato: "80 colaboradores" },
      estado,
      semCliente
    );
    expect(r.status).toBe("contexto_registrado");
    expect(estado.cliente).toMatchObject({ tipo: "PJ", nome: "Ana", empresa: "Acme" });
    expect(estado.necessidade.ocasiao).toBe("confraternização");
    expect(estado.memoria?.fatos).toEqual(["80 colaboradores"]);
  });

  it("não repete fato e guarda só os mais recentes", async () => {
    const estado = createInitialState("5583999990000");
    await registrarContextoHandler({ fato: "Prefere azul" }, estado, semCliente);
    await registrarContextoHandler({ fato: "prefere azul" }, estado, semCliente);
    expect(estado.memoria?.fatos).toHaveLength(1);
    for (let i = 0; i < MAX_FATOS_MEMORIA + 3; i++) await registrarContextoHandler({ fato: `fato ${i}` }, estado, semCliente);
    expect(estado.memoria?.fatos).toHaveLength(MAX_FATOS_MEMORIA);
    expect(estado.memoria?.fatos.at(-1)).toBe(`fato ${MAX_FATOS_MEMORIA + 2}`);
  });

  it("chamada vazia não muda nada", async () => {
    const estado = createInitialState("5583999990000");
    expect((await registrarContextoHandler({}, estado, semCliente)).status).toBe("nada_para_registrar");
    expect(estado.memoria).toBeUndefined();
  });
});
