import { describe, it, expect } from "vitest";
import {
  decidirSaude,
  desconexaoTerminal,
  naoLidasDoCliente,
  novoEstadoSaude,
  tipoDaMensagem,
} from "../src/whatsapp/saude.js";

describe("desconexaoTerminal", () => {
  it("logout, desvinculação e bloqueio são terminais; queda comum não", () => {
    for (const m of ["LOGOUT", "UNPAIRED", "UNPAIRED_IDLE", "TOS_BLOCK", "SMB_TOS_BLOCK"]) {
      expect(desconexaoTerminal(m)).toBe(true);
    }
    for (const m of ["NAVIGATION", "CONFLICT", "TIMEOUT", "OPENING"]) expect(desconexaoTerminal(m)).toBe(false);
  });
});

describe("naoLidasDoCliente", () => {
  const m = (id: string, fromMe: boolean, type = "chat") => ({ id, fromMe, type });

  it("pega as últimas N mensagens do cliente, ignorando as nossas no meio", () => {
    const recentes = [m("1", false), m("2", true), m("3", false), m("4", true), m("5", false)];
    expect(naoLidasDoCliente(recentes, 2).map((x) => x.id)).toEqual(["3", "5"]);
  });

  it("deixa de fora a que ainda está cifrada (chega depois pelo evento ao vivo)", () => {
    const recentes = [m("1", false), m("2", false, "ciphertext")];
    expect(naoLidasDoCliente(recentes, 2).map((x) => x.id)).toEqual(["1"]);
  });

  it("zero não lidas → nada", () => {
    expect(naoLidasDoCliente([m("1", false)], 0)).toEqual([]);
  });
});

describe("decidirSaude", () => {
  it("CONNECTED é ok", () => {
    expect(decidirSaude("CONNECTED", novoEstadoSaude())).toBe("ok");
  });

  it("estado ruim só reconecta na 3ª leitura seguida e zera a contagem", () => {
    const s = novoEstadoSaude();
    expect(decidirSaude(null, s)).toBe("aguardar");
    expect(decidirSaude("OPENING", s)).toBe("aguardar");
    expect(decidirSaude("TIMEOUT", s)).toBe("reconectar");
    expect(s.naoSaudaveis).toBe(0);
  });

  it("uma leitura boa no meio zera a contagem", () => {
    const s = novoEstadoSaude();
    decidirSaude(null, s);
    decidirSaude(null, s);
    expect(decidirSaude("CONNECTED", s)).toBe("ok");
    expect(decidirSaude(null, s)).toBe("aguardar");
  });

  it("UNPAIRED confirmado 3 vezes → desvinculado, e depois disso nunca tenta de novo", () => {
    const s = novoEstadoSaude();
    expect(decidirSaude("UNPAIRED", s)).toBe("aguardar");
    expect(decidirSaude("UNPAIRED_IDLE", s)).toBe("aguardar");
    expect(decidirSaude("UNPAIRED", s)).toBe("desvinculado");
    expect(decidirSaude(null, s)).toBe("aguardar");
    expect(decidirSaude(null, s)).toBe("aguardar");
    expect(decidirSaude(null, s)).toBe("aguardar");
  });

  it("[F14] UNPAIRED precisa de 3 confirmações seguidas, sem somar estados de outro tipo", () => {
    const s = novoEstadoSaude();
    decidirSaude("TIMEOUT", s);
    decidirSaude(null, s);
    expect(decidirSaude("UNPAIRED", s)).toBe("aguardar");
    expect(decidirSaude("UNPAIRED", s)).toBe("aguardar");
    expect(decidirSaude("UNPAIRED", s)).toBe("desvinculado");
  });

  it("CONNECTED com 3 batimentos falhos é página zumbi → reconectar", () => {
    const s = novoEstadoSaude();
    s.falhasBatimento = 3;
    expect(decidirSaude("CONNECTED", s)).toBe("reconectar");
    expect(s.falhasBatimento).toBe(0);
  });
});

describe("tipoDaMensagem", () => {
  it("mapeia os tipos do whatsapp-web.js", () => {
    expect(tipoDaMensagem("chat")).toBe("texto");
    expect(tipoDaMensagem("image")).toBe("midia");
    expect(tipoDaMensagem("document")).toBe("midia");
    expect(tipoDaMensagem("video")).toBe("nao_suportada");
    expect(tipoDaMensagem("ptt")).toBe("audio");
    expect(tipoDaMensagem("audio")).toBe("audio");
    for (const t of ["sticker", "location", "vcard", "multi_vcard", "revoked", "reaction", "e2e_notification", "poll_creation"]) {
      expect(tipoDaMensagem(t)).toBe("ignorada");
    }
  });
});
