import { createHash } from "crypto";

export function calcularTurnoId(ids: string[]): string {
  return createHash("sha256").update(ids.join("\n")).digest("hex").slice(0, 16);
}
