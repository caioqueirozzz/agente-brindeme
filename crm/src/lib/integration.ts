import { timingSafeEqual } from "node:crypto";

/** Chamadas da ponte/sync do agente: header x-crm-secret igual a CRM_INTEGRATION_SECRET. */
export function integrationAuthorized(request: Request): boolean {
  const expected = process.env.CRM_INTEGRATION_SECRET;
  const given = request.headers.get("x-crm-secret");
  if (!expected || expected.length < 16 || !given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}
