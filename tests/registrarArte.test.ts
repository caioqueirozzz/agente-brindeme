import { describe, it, expect } from "vitest";
import { MockBrindeMeClient } from "../src/integrations/brindeme/mockClient.js";
import { registrarArteHandler } from "../src/tools/registrarArte.js";
import { createInitialState } from "../src/agent/state.js";

describe("registrarArte", () => {
  const client = new MockBrindeMeClient();

  it("aceita PNG e salva no estado", async () => {
    const state = createInitialState("5583999990000");
    const result = await registrarArteHandler({ descricao_arquivo: "logo.png" }, state, client) as { status: string; arte_ref: string };
    expect(result.status).toBe("arte_registrada");
    expect(state.artes).toHaveLength(1);
    expect(state.artes[0].arquivo).toBe("logo.png");
  });

  it("rejeita .exe com formatos aceitos", async () => {
    const state = createInitialState("5583999990000");
    const result = await registrarArteHandler({ descricao_arquivo: "malware.exe" }, state, client) as { erro: string; formatos_aceitos: string };
    expect(result.erro).toBe("formato_nao_aceito");
    expect(result.formatos_aceitos).toContain("png");
    expect(state.artes).toHaveLength(0);
  });

  it("aceita PDF", async () => {
    const state = createInitialState("5583999990000");
    const result = await registrarArteHandler({ descricao_arquivo: "arte.pdf" }, state, client) as { status: string };
    expect(result.status).toBe("arte_registrada");
  });

  it("rejeita arquivo sem extensão", async () => {
    const state = createInitialState("5583999990000");
    const result = await registrarArteHandler({ descricao_arquivo: "semextensao" }, state, client) as { erro: string };
    expect(result.erro).toBe("formato_nao_aceito");
  });
});
