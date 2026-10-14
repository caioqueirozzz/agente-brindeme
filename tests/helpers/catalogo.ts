import { MockBrindeMeClient } from "../../src/integrations/brindeme/mockClient.js";
import {
  MemoryProductIndexStore,
  sincronizarCatalogo,
} from "../../src/catalogo/indice.js";
import { MemoryOccasionTagStore } from "../../src/catalogo/ocasioes.js";
import { setProductIndexStore, setOccasionTagStore } from "../../src/tools/buscarProdutos.js";

/**
 * Índice equivalente ao que `npm run sync:catalogo` produziria a partir dos
 * mocks. Usa um cliente PRÓPRIO: a sincronização consumiria as falhas
 * injetadas no cliente que o teste está exercitando.
 */
export async function indiceDoMock(): Promise<MemoryProductIndexStore> {
  const store = new MemoryProductIndexStore();
  await sincronizarCatalogo(new MockBrindeMeClient(), store);
  return store;
}

/** Aponta buscar_produtos para o índice dos mocks e para uma tabela de etiquetas vazia. */
export async function usarIndiceDoMock(): Promise<MemoryProductIndexStore> {
  const store = await indiceDoMock();
  setProductIndexStore(store);
  setOccasionTagStore(new MemoryOccasionTagStore());
  return store;
}
