import { mkdirSync, mkdtempSync, utimesSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { temErro, verificarAmbiente, type FatosAmbiente } from "../src/operacao/verificacaoAmbiente.js";
import { apagar, selecionarParaLimpeza } from "../src/operacao/retencao.js";
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
  ORCAMENTO_ESCRITA: "real",
  WHATSAPP_LIBERADOS: "5583999990000",
};

describe("verificar:env", () => {
  it("piloto bem configurado: sem erro e sem aviso", () => {
    const a = verificarAmbiente(ENV_PILOTO, FATOS_OK, { producao: true });
    expect(a.filter((x) => x.gravidade !== "ok")).toEqual([]);
  });

  it("chave de exemplo, modelo vazio e mock em produção são ERRO", () => {
    const a = verificarAmbiente({ ...ENV_PILOTO, OPENAI_API_KEY: "sk-...", LLM_MODEL: "", BRINDEME_MODE: "mock", ORCAMENTO_ESCRITA: "simulada" }, FATOS_OK, { producao: true });
    const erros = a.filter((x) => x.gravidade === "erro").map((x) => x.item);
    expect(erros).toEqual(expect.arrayContaining(["OPENAI_API_KEY", "LLM_MODEL", "BRINDEME_MODE"]));
    expect(temErro(a)).toBe(true);
  });

  it("em desenvolvimento, mock e rascunho só avisam", () => {
    const a = verificarAmbiente({ ...ENV_PILOTO, BRINDEME_MODE: "mock", ORCAMENTO_ESCRITA: "simulada", KB_INCLUIR_RASCUNHOS: "true" }, FATOS_OK, { producao: false });
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
});

describe("relatorio:piloto", () => {
  const conv = (eventos: Array<Record<string, unknown>>) =>
    eventos.map((e, i) => ({ timestamp: `2026-10-20T10:00:0${i}.000Z`, ...e }));

  it("conta conversas, orçamentos, transferências por motivo, tokens e lacunas", () => {
    const r = resumirLogs([
      conv([
        { type: "message_received" },
        { type: "tool_call", name: "criar_orcamento", output: { status: "criado" } },
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
    expect(r.orcamentosCriados).toBe(1);
    expect(r.transferencias).toEqual({
      total: 2,
      porMotivo: { lacuna_conhecimento: 1, "falha_sistema (sistema)": 1 },
      conversasTransferidas: 2,
    });
    expect(r.tokens).toEqual({ entrada: 150, saida: 30 });
    expect(r.lacunas).toEqual([{ pergunta: "posso retirar?", vezes: 1 }]);
    const md = formatarRelatorio(r);
    expect(md).toContain("| Conversas transferidas | 2 (67%) |");
    expect(md).toContain("posso retirar? (1×)");
  });

  it("--desde corta eventos antigos", () => {
    const r = resumirLogs([[{ timestamp: "2026-10-01T00:00:00Z", type: "message_received" }]], "2026-10-15");
    expect(r.conversas).toBe(0);
  });
});
