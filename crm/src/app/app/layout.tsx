import { Portal } from "@/components/portal/Portal";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <Portal role="COLABORADOR">{children}</Portal>;
}
