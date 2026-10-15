import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { AgenteDefinitivo } from "../src/api/agenteDefinitivo.js";
import { RepositorioConversas } from "../src/conversas/repositorio.js";
import { MockBrindeMeClient } from "../src/integrations/brindeme/mockClient.js";
import { ScriptedLLM } from "./helpers/llmRoteirizado.js";
import { bateriaContrato } from "./helpers/bateriaContrato.js";

bateriaContrato(
  "API definitiva",
  ({ atrasoMs }) =>
    new AgenteDefinitivo({
      repo: new RepositorioConversas(mkdtempSync(join(tmpdir(), "contrato-"))),
      llm: new ScriptedLLM([], atrasoMs),
      client: new MockBrindeMeClient(),
      tetoMs: 90_000,
      respostasPorHora: 30,
    })
);
