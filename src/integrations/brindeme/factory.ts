import type { BrindeMeClient } from "./client.js";
import { MockBrindeMeClient } from "./mockClient.js";
import { HttpBrindeMeClient } from "./httpClient.js";
import { EscritaSimuladaClient } from "./escritaSimulada.js";
import { config } from "../../config.js";

/** Escolhe a implementação pelo BRINDEME_MODE. As tools não sabem qual é. */
export function createBrindeMeClient(): BrindeMeClient {
  if (config.brindeMe.mode !== "http") return new MockBrindeMeClient();
  const http = new HttpBrindeMeClient();
  return config.brindeMe.escritaOrcamento === "real"
    ? http
    : new EscritaSimuladaClient(http, config.brindeMe.orcamentosTesteArquivo);
}
