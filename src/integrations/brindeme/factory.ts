import type { BrindeMeClient } from "./client.js";
import { MockBrindeMeClient } from "./mockClient.js";
import { HttpBrindeMeClient } from "./httpClient.js";
import { config } from "../../config.js";

/** Escolhe a implementação pelo BRINDEME_MODE. As tools não sabem qual é. */
export function createBrindeMeClient(opcoes: { reqPorMinuto?: number } = {}): BrindeMeClient {
  if (config.brindeMe.mode !== "http") return new MockBrindeMeClient();
  return new HttpBrindeMeClient({ reqPorMinuto: opcoes.reqPorMinuto });
}
