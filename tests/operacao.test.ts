import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { temErro, verificarAmbiente, type FatosAmbiente } from "../src/operacao/verificacaoAmbiente.js";
import { apagar, selecionarCliente, selecionarParaLimpeza } from "../src/operacao/retencao.js";
import { formatarRelatorio, resumirLogs } from "../src/operacao/relatorio.js";

const FATOS_OK: FatosAmbiente = {
  temArquivoEnv: true,
  produtosNoIndice: 6527,
  itensAprovados: 12,
  suspenso: false,
  ferramentasDesligadasRuntime: [],
};

const ENV_PILOTO = {
  OPENAI_API_KEY: "sk-proj-abc123",
  LLM_MODEL: "gpt-6-luna",
  LLM_REASONING: "none",
  BRINDEME_MODE: "http",
  BRINDEME_BASE_URL: "https://api.loja.com.br",
  BRINDEME_TOKEN: "tok",
  WHATSAPP_LIBERADOS: "5583999990000",
};

describe("verificar:env", () => {
  it("piloto bem configurado: sem erro e sem aviso", () => {
    const a = verificarAmbiente(ENV_PILOTO, FATOS_OK, { producao: true });
    expect(a.filter((x) => x.gravidade !== "ok")).toEqual([]);
  });

  it("chave de exemplo, modelo vazio e mock em produção são ERRO", () => {
    const a = verificarAmbiente({ ...ENV_PILOTO, OPENAI_API_KEY: "sk-...", LLM_MODEL: "", BRINDEME_MODE: "mock" }, FATOS_OK, { producao: true });
    const erros = a.filter((x) => x.gravidade === "erro").map((x) => x.item);
    expect(erros).toEqual(expect.arrayContaining(["OPENAI_API_KEY", "LLM_MODEL", "BRINDEME_MODE"]));
    expect(temErro(a)).toBe(true);
  });

  it("em desenvolvimento, mock e rascunho só avisam", () => {
    const a = verificarAmbiente({ ...ENV_PILOTO, BRINDEME_MODE: "mock", KB_INCLUIR_RASCUNHOS: "true" }, FATOS_OK, { producao: false });
    expect(temErro(a)).toBe(false);
    expect(a.filter((x) => x.gravidade === "aviso").map((x) => x.item)).toEqual(expect.arrayContaining(["BRINDEME_MODE", "KB_INCLUIR_RASCUNHOS"]));
  });

  it("http sem https, sem token, ferramenta com nome errado e prazos invertidos são ERRO", () => {
    const a = verificarAmbiente(
      { ...ENV_PILOTO, BRINDEME_BASE_URL: "http://api.loja.com.br", BRINDEME_TOKEN: "", FERRAMENTAS_DESLIGADAS: "criar_orcamentos", TURNO_TETO_MS: "130000" },
      FATOS_OK,
      { producao: true }
    );
    const erros = a.filter((x) => x.gravidade === "erro").map((x) => x.item);
    expect(erros).toEqual(expect.arrayContaining(["BRINDEME_BASE_URL", "BRINDEME_TOKEN", "FERRAMENTAS_DESLIGADAS", "TURNO_TETO_MS"]));
  });

  it("avisa base sem item aprovado, número liberado vazio, reasoning low e agente suspenso", () => {
    const a = verificarAmbiente(
      { ...ENV_PILOTO, WHATSAPP_LIBERADOS: "", LLM_REASONING: "low" },
      { ...FATOS_OK, itensAprovados: 0, suspenso: true },
      { producao: true }
    );
    expect(a.filter((x) => x.gravidade === "aviso").map((x) => x.item)).toEqual(
      expect.arrayContaining(["base de conhecimento", "WHATSAPP_LIBERADOS", "LLM_REASONING", "estado-sistema"])
    );
  });

  it("LLM_REASONING preenchido com modelo da família gpt-4 é ERRO; vazio passa", () => {
    const comNone = verificarAmbiente({ ...ENV_PILOTO, LLM_MODEL: "gpt-4o-mini", LLM_REASONING: "none" }, FATOS_OK, { producao: false });
    expect(comNone.filter((x) => x.gravidade === "erro").map((x) => x.item)).toContain("LLM_REASONING");
    const vazio = verificarAmbiente({ ...ENV_PILOTO, LLM_MODEL: "gpt-4o-mini", LLM_REASONING: "" }, FATOS_OK, { producao: true });
    expect(vazio.filter((x) => x.item === "LLM_REASONING")).toEqual([]);
  });

  it("nunca mostra o valor da chave nem do token", () => {
    const texto = JSON.stringify(verificarAmbiente(ENV_PILOTO, FATOS_OK, { producao: true }));
    expect(texto).not.toContain("sk-proj-abc123");
    expect(texto).not.toContain('"tok"');
  });
});

describe("limpar:dados (retenção)", () => {
  const DIA = 86_400_000;
  const agora = Date.parse("2026-10-19T12:00:00Z");

  function montar() {
    const raiz = mkdtempSync(join(tmpdir(), "retencao-"));
    const pastas = { conversas: join(raiz, "conversas"), artes: join(raiz, "artes"), logs: join(raiz, "logs") };
    for (const p of Object.values(pastas)) mkdirSync(p);
    const arquivo = (caminho: string, diasAtras: number) => {
      writeFileSync(caminho, "x");
      const t = new Date(agora - diasAtras * DIA);
      utimesSync(caminho, t, t);
    };
    arquivo(join(pastas.conversas, "5583999990000.json"), 120); // parado
    arquivo(join(pastas.conversas, "5511988887777.json"), 5); // ativo
    mkdirSync(join(pastas.artes, "5583999990000"));
    arquivo(join(pastas.artes, "5583999990000", "logo.png"), 120);
    mkdirSync(join(pastas.artes, "5511988887777"));
    arquivo(join(pastas.artes, "5511988887777", "velha.png"), 200); // cliente ativo: fica
    arquivo(join(pastas.logs, "conv-antiga.jsonl"), 100);
    arquivo(join(pastas.logs, "conv-nova.jsonl"), 1);
    arquivo(join(pastas.logs, "api.jsonl"), 400);
    return pastas;
  }

  it("seleciona só o que passou do prazo; artes de cliente ativo e api.jsonl ficam", () => {
    const pastas = montar();
    const alvos = selecionarParaLimpeza(pastas, 90, agora);
    expect(alvos.map((a) => `${a.tipo}:${a.caminho.split(/[\\/]/).slice(-1)[0]}`).sort()).toEqual(
      ["artes:5583999990000", "conversa:5583999990000.json", "log:conv-antiga.jsonl"].sort()
    );
  });

  it("selecionar não apaga; apagar remove o que foi selecionado", () => {
    const pastas = montar();
    const alvos = selecionarParaLimpeza(pastas, 90, agora);
    expect(alvos.every((a) => existsSync(a.caminho))).toBe(true);
    expect(apagar(alvos)).toBe(3);
    expect(alvos.some((a) => existsSync(a.caminho))).toBe(false);
    expect(existsSync(join(pastas.conversas, "5511988887777.json"))).toBe(true);
  });

  it("prazo inválido é recusado", () => {
    expect(() => selecionarParaLimpeza(montar(), 0, agora)).toThrow();
  });

  describe("arquivos com registros de vários clientes (orçamentos TESTE, ponte, lacunas)", () => {
    const VELHO = "5583999990000";
    const ATIVO = "5511988887777";
    const iso = (diasAtras: number) => new Date(agora - diasAtras * DIA).toISOString();

    function montarCompleto() {
      const pastas = montar();
      const raiz = join(pastas.conversas, "..");
      writeFileSync(
        join(pastas.conversas, `${ATIVO}.json`),
        JSON.stringify({ versao: 1, estado: { conversaId: "conv-nova", telefone: ATIVO } })
      );
      const completo = {
        ...pastas,
        orcamentosTeste: join(raiz, "orcamentos-teste.json"),
        ponteEstado: join(raiz, "ponte-estado.json"),
        lacunas: join(raiz, "lacunas.jsonl"),
      };
      writeFileSync(
        completo.orcamentosTeste,
        JSON.stringify([
          { id: "t1", code: "TESTE-1", customer_phone: VELHO, customer_email: "a@a.com", created_at: iso(120) },
          { id: "t2", code: "TESTE-2", customer_phone: ATIVO, customer_email: "b@b.com", created_at: iso(5) },
        ])
      );
      writeFileSync(
        completo.ponteEstado,
        JSON.stringify({
          versao: 1,
          modos: { [VELHO]: "humano", [ATIVO]: "ia" },
          eventosPendentes: [
            { tipo: "devolver", telefone: VELHO },
            { tipo: "devolver", telefone: ATIVO },
          ],
          avisosPendentes: [],
          concluidos: [],
          entregasParciais: { [VELHO]: { ids: ["m1"], partes: ["oi"] } },
        })
      );
      writeFileSync(
        completo.lacunas,
        [
          JSON.stringify({ pergunta: "velha", conversa_id: "conv-antiga", registrado_em: iso(120) }),
          JSON.stringify({ pergunta: "nova", conversa_id: "conv-nova", registrado_em: iso(5) }),
        ].join("\n") + "\n"
      );
      return completo;
    }

    const ler = (caminho: string) => readFileSync(caminho, "utf-8");
    const lacunasDe = (caminho: string) => ler(caminho).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).pergunta);

    it("por prazo: orçamento TESTE e lacuna velhos saem; na ponte, só o telefone cuja conversa saiu", () => {
      const pastas = montarCompleto();
      apagar(selecionarParaLimpeza(pastas, 90, agora));

      expect(JSON.parse(ler(pastas.orcamentosTeste)).map((b: { id: string }) => b.id)).toEqual(["t2"]);
      expect(lacunasDe(pastas.lacunas)).toEqual(["nova"]);
      const ponte = JSON.parse(ler(pastas.ponteEstado));
      expect(ponte.modos).toEqual({ [ATIVO]: "ia" });
      expect(ponte.entregasParciais).toEqual({});
      expect(ponte.eventosPendentes).toEqual([{ tipo: "devolver", telefone: ATIVO }]);
    });

    it("a simulação lista os registros e não altera nenhum arquivo", () => {
      const pastas = montarCompleto();
      const antes = [pastas.orcamentosTeste, pastas.ponteEstado, pastas.lacunas].map(ler);

      const alvos = selecionarParaLimpeza(pastas, 90, agora).filter((a) => a.tipo === "registros");

      expect(alvos.map((a) => [a.caminho.split(/[\\/]/).at(-1), a.registros]).sort()).toEqual(
        [["lacunas.jsonl", 1], ["orcamentos-teste.json", 1], ["ponte-estado.json", 3]].sort()
      );
      expect([pastas.orcamentosTeste, pastas.ponteEstado, pastas.lacunas].map(ler)).toEqual(antes);
    });

    it("--telefone apaga tudo de um cliente, mesmo ativo, e não toca nos outros", () => {
      const pastas = montarCompleto();
      apagar(selecionarCliente(pastas, ATIVO));

      expect(existsSync(join(pastas.conversas, `${ATIVO}.json`))).toBe(false);
      expect(existsSync(join(pastas.artes, ATIVO))).toBe(false);
      expect(existsSync(join(pastas.logs, "conv-nova.jsonl"))).toBe(false);
      expect(JSON.parse(ler(pastas.orcamentosTeste)).map((b: { id: string }) => b.id)).toEqual(["t1"]);
      expect(lacunasDe(pastas.lacunas)).toEqual(["velha"]);
      const ponte = JSON.parse(ler(pastas.ponteEstado));
      expect(Object.keys(ponte.modos)).toEqual([VELHO]);
      expect(ponte.eventosPendentes).toEqual([{ tipo: "devolver", telefone: VELHO }]);

      expect(existsSync(join(pastas.conversas, `${VELHO}.json`))).toBe(true);
      expect(existsSync(join(pastas.artes, VELHO))).toBe(true);
      expect(existsSync(join(pastas.logs, "conv-antiga.jsonl"))).toBe(true);
    });

    it("--telefone sem nada guardado não seleciona nada; telefone inválido é recusado", () => {
      const pastas = montarCompleto();
      expect(selecionarCliente(pastas, "5521900000000")).toEqual([]);
      expect(() => selecionarCliente(pastas, "abc")).toThrow();
    });
  });
});

describe("relatorio:piloto", () => {
  const conv = (eventos: Array<Record<string, unknown>>) =>
    eventos.map((e, i) => ({ timestamp: `2026-10-20T10:00:0${i}.000Z`, ...e }));

  it("conta conversas, orçamentos, transferências por motivo, tokens e lacunas", () => {
    const r = resumirLogs([
      conv([
        { type: "message_received" },
        { type: "tool_call", name: "transferir_humano", input: { motivo: "orcamento_para_emitir" }, output: { status: "transferido" } },
        { type: "response_sent", input_tokens: 100, output_tokens: 20 },
      ]),
      conv([
        { type: "message_received" },
        { type: "kb_consulta", pergunta: "Posso retirar?", resultado: "lacuna" },
        { type: "tool_call", name: "transferir_humano", input: { motivo: "lacuna_conhecimento" }, output: { status: "transferido" } },
        { type: "response_sent", input_tokens: 50, output_tokens: 10 },
      ]),
      conv([{ type: "message_received" }, { type: "transfer", motivo: "falha_sistema" }, { type: "alerta", motivo: "teto_do_turno" }]),
    ]);
    expect(r.conversas).toBe(3);
    expect(r.orcamentosParaEmitir).toBe(1);
    expect(r.transferencias).toEqual({
      total: 3,
      porMotivo: { orcamento_para_emitir: 1, lacuna_conhecimento: 1, "falha_sistema (sistema)": 1 },
      conversasTransferidas: 3,
    });
    expect(r.tokens).toEqual({ entrada: 150, saida: 30 });
    expect(r.lacunas).toEqual([{ pergunta: "posso retirar?", vezes: 1 }]);
    const md = formatarRelatorio(r);
    expect(md).toContain("| Conversas transferidas | 3 (100%) |");
    expect(md).toContain("| Orçamentos enviados para emitir | 1 |");
    expect(md).toContain("posso retirar? (1×)");
  });

  it("--desde corta eventos antigos", () => {
    const r = resumirLogs([[{ timestamp: "2026-10-01T00:00:00Z", type: "message_received" }]], "2026-10-15");
    expect(r.conversas).toBe(0);
  });
});
