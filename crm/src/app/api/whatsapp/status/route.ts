import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { isAdmin, requireUser } from "@/lib/access";
import { callPonte } from "@/lib/whatsapp";
import type { PonteStatus } from "@/lib/whatsapp";

/**
 * Estado do número da loja. O QR (que vincula o WhatsApp da empresa) só vai para o admin;
 * o colaborador recebe apenas se está conectado, para saber se pode responder pelo CRM.
 */
export async function GET() {
  const guard = await requireUser();
  if (guard.error) return guard.error;
  const result = await callPonte<PonteStatus>("/status", undefined, 8_000);
  if (!result.ok) {
    return NextResponse.json({ ponte: result.offline ? "offline" : "erro", error: result.error, estado: null, qr: null, telefone: null, nome: null, conectadoEm: null });
  }
  const s = result.data;
  const admin = isAdmin(guard.user);
  return NextResponse.json({
    ponte: "online",
    estado: s.estado,
    telefone: s.telefone,
    nome: admin ? s.nome : null,
    conectadoEm: s.conectadoEm,
    ultimoErro: admin ? s.ultimoErro : null,
    qr: admin && s.qr ? await QRCode.toDataURL(s.qr, { margin: 1, width: 320, errorCorrectionLevel: "M" }) : null,
  });
}
