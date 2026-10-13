import type { BrindeMeClient } from "./client.js";
import { MockBrindeMeClient } from "./mockClient.js";
import { HttpBrindeMeClient } from "./httpClient.js";
import { config } from "../../config.js";

/** Escolhe a implementação pelo BRINDEME_MODE. As tools não sabem qual é. */
export function createBrindeMeClient(): BrindeMeClient {
  return config.brindeMe.mode === "http"
    ? new HttpBrindeMeClient()
    : new MockBrindeMeClient();
}
