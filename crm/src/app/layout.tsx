import type { Metadata } from "next";
import { Inter, Montserrat } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], weight: ["300", "400", "600", "700", "800"] });
// A folha do Google define font-size: 24px sem camada, e CSS sem camada vence os
// utilitários do Tailwind 4 (text-[18px] nos ícones era ignorado). Importada aqui,
// dentro de layer(base), o tamanho volta a obedecer às classes. Fica num <style>
// próprio porque @import precisa ser a primeira regra da folha.
const ICON_FONT = `@import url("https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=block") layer(base);`;

const montserrat = Montserrat({ subsets: ["latin"], variable: "--font-montserrat" });

export const metadata: Metadata = {
  title: "Presentes Especiais | CRM Comercial",
  description: "Gestão comercial interna da Presentes Especiais: leads, conversas, quadros e PresentesIA.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className={`${inter.className} ${montserrat.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: ICON_FONT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
