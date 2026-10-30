import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, homeFor, verifySession } from "@/lib/auth/token";

/*
 * Roda antes de cada navegação: só confere a assinatura do token (rápido)
 * e manda cada papel para o seu portal. As APIs ficam fora do matcher e
 * validam a sessão no banco por conta própria.
 *
 *  /admin/*  → só ADMIN
 *  /app/*    → só COLABORADOR (o admin fica no painel dele)
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const claims = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  const redirect = (path: string) => NextResponse.redirect(new URL(path, request.url));

  if (pathname === "/") return redirect(claims ? (claims.pwd ? "/trocar-senha" : homeFor(claims.role)) : "/login");

  if (pathname === "/login") return claims ? redirect(claims.pwd ? "/trocar-senha" : homeFor(claims.role)) : NextResponse.next();

  if (pathname === "/trocar-senha") return claims ? NextResponse.next() : redirect("/login");

  if (pathname.startsWith("/admin") || pathname.startsWith("/app")) {
    if (!claims) {
      const url = new URL("/login", request.url);
      url.searchParams.set("redirect", pathname);
      return NextResponse.redirect(url);
    }
    if (claims.pwd) return redirect("/trocar-senha");
    if (pathname.startsWith("/admin") && claims.role !== "ADMIN") return redirect("/app/inicio");
    if (pathname.startsWith("/app") && claims.role === "ADMIN") return redirect(pathname.replace(/^\/app/, "/admin"));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
