import { describe, it, expect, vi } from "vitest";
import { createInitialState } from "../src/agent/state.js";
import { MockBrindeMeClient } from "../src/integrations/brindeme/mockClient.js";
import { transferirHumanoHandler } from "../src/tools/transferirHumano.js";
import { registrarArteHandler } from "../src/tools/registrarArte.js";

const TEL = "5583999990000";

describe("transferir_humano com a API da loja fora", () => {
  it("transfere mesmo quando listAdmins falha", async () => {
    const client = new MockBrindeMeClient();
    vi.spyOn(client, "listAdmins").mockRejectedValue(new Error("API fora"));
    const state = createInitialState(TEL);

    const r = await transferirHumanoHandler({ motivo: "falha_sistema", prioridade: "alta" }, state, client);

    expect(r.status).toBe("transferido");
    expect(r.resumo_para_atendente.responsavel).toEqual({ id: "desconhecido", nome: "Equipe" });
    expect(state.modo).toBe("humano");
  });

  it("transfere em até 5s mesmo com listAdmins pendurado", async () => {
    vi.useFakeTimers();
    try {
      const client = new MockBrindeMeClient();
      vi.spyOn(client, "listAdmins").mockImplementation(() => new Promise(() => {}));
      const state = createInitialState(TEL);
      const r = transferirHumanoHandler({ motivo: "falha_sistema", prioridade: "alta" }, state, client);
      await vi.advanceTimersByTimeAsync(5_000);
      expect((await r).resumo_para_atendente.responsavel.nome).toBe("Equipe");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("registrar_arte com arquivo que chegou pelo WhatsApp", () => {
  it("registra o caminho real do arquivo recebido", async () => {
    const state = createInitialState(TEL);
    state.arquivosRecebidos = [{ nome: "Logo.PNG", caminho: "C:/artes/5583999990000/abc.png", mime: "image/png", bytes: 4_096 }];

    const r = await registrarArteHandler({ descricao_arquivo: "logo.png", posicao: "frente" }, state, new MockBrindeMeClient());

    expect(r).toMatchObject({ status: "arte_registrada", arquivo: "Logo.PNG", tamanho_kb: 4 });
    expect(state.artes).toEqual([
      { ref: expect.stringMatching(/^arte-/), arquivo: "C:/artes/5583999990000/abc.png", posicao: "frente", cores: undefined },
    ]);
  });

  it("sem arquivo recebido, continua validando pela extensão", async () => {
    const state = createInitialState(TEL);
    const r = await registrarArteHandler({ descricao_arquivo: "virus.exe" }, state, new MockBrindeMeClient());
    expect(r).toMatchObject({ erro: "formato_nao_aceito" });
  });

  it("no WhatsApp, nome que não chegou vira erro com a lista do que chegou", async () => {
    const state = createInitialState(TEL);
    state.canal = "whatsapp";
    state.arquivosRecebidos = [{ nome: "logo.png", caminho: "C:/artes/abc.png", mime: "image/png", bytes: 2_048 }];
    const r = await registrarArteHandler({ descricao_arquivo: "outra.png" }, state, new MockBrindeMeClient());
    expect(r).toMatchObject({ erro: "arquivo_nao_recebido", arquivos_recebidos: ["logo.png"] });
    expect(state.artes).toEqual([]);
  });

  it("a mesma arte registrada de novo devolve a referência que já existe", async () => {
    const state = createInitialState(TEL);
    state.canal = "whatsapp";
    state.arquivosRecebidos = [{ nome: "logo.png", caminho: "C:/artes/abc.png", mime: "image/png", bytes: 2_048 }];
    const a = await registrarArteHandler({ descricao_arquivo: "logo.png" }, state, new MockBrindeMeClient());
    const b = await registrarArteHandler({ descricao_arquivo: "logo.png" }, state, new MockBrindeMeClient());
    expect(state.artes).toHaveLength(1);
    expect((b as { arte_ref: string }).arte_ref).toBe((a as { arte_ref: string }).arte_ref);
  });

  it("estado novo já nasce com a lista de arquivos vazia", () => {
    expect(createInitialState(TEL).arquivosRecebidos).toEqual([]);
  });
});
