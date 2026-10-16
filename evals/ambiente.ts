import { MockBrindeMeClient } from "../src/integrations/brindeme/mockClient.js";
import { MemoryProductIndexStore, sincronizarCatalogo } from "../src/catalogo/indice.js";
import { MemoryOrderIndexStore, sincronizarPedidos } from "../src/integrations/brindeme/orderIndex.js";
import { setProductIndexStore } from "../src/tools/buscarProdutos.js";
import { setOrderIndexStore } from "../src/tools/consultarPedido.js";
import { setLacunaStore } from "../src/tools/consultarConhecimento.js";
import { MemoryLacunaStore } from "../src/knowledge/lacunas.js";

/** Os cenários rodam só sobre os mocks: nada lido de data/ nem gravado na fila real de lacunas. */
export async function prepararAmbienteDosEvals(): Promise<void> {
  const produtos = new MemoryProductIndexStore();
  await sincronizarCatalogo(new MockBrindeMeClient(), produtos);
  setProductIndexStore(produtos);

  const pedidos = new MemoryOrderIndexStore();
  await sincronizarPedidos(new MockBrindeMeClient(), pedidos);
  setOrderIndexStore(pedidos);

  setLacunaStore(new MemoryLacunaStore());
}
