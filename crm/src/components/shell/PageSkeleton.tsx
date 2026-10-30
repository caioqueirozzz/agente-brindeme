/**
 * Esqueleto mostrado enquanto a próxima página carrega (loading.tsx). Com
 * ele, o clique troca de tela na hora e a navbar continua utilizável.
 */
export function PageSkeleton() {
  return (
    <div className="space-y-8 animate-pulse" aria-busy="true" aria-label="Carregando">
      <div className="space-y-3">
        <div className="h-9 w-64 max-w-full rounded-full bg-on-surface/10" />
        <div className="h-5 w-96 max-w-full rounded-full bg-on-surface/[0.06]" />
      </div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-28 rounded-xl bg-on-surface/[0.06]" />
        ))}
      </div>
      <div className="h-80 rounded-xl bg-on-surface/[0.06]" />
    </div>
  );
}
