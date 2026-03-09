import Link from 'next/link'

export default function RestaurantLandingPage() {
  return (
    <main className="min-h-screen bg-slate-950 px-4 py-16 text-white md:px-8">
      <div className="mx-auto max-w-5xl space-y-10">
        <div className="space-y-4">
          <div className="inline-flex rounded-full border border-white/10 bg-white/5 px-4 py-1 text-xs uppercase tracking-[0.28em] text-cyan-200/80">
            Restaurant SaaS night build
          </div>
          <h1 className="text-4xl font-semibold tracking-tight md:text-6xl">Base operativa para restaurante: carta digital, pedido, cocina e inventario.</h1>
          <p className="max-w-3xl text-lg text-slate-300">
            Vertical slice serio y extensible sobre Open Mercato para modelar el flujo completo desde la mesa hasta cocina,
            sala y reposición de stock basada en recetas.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Link href="/restaurant/table/t12" className="rounded-[28px] border border-cyan-400/20 bg-gradient-to-br from-cyan-400/15 to-violet-500/15 p-6 transition hover:border-cyan-300/40 hover:bg-white/10">
            <div className="text-sm uppercase tracking-[0.22em] text-cyan-100/80">Demo principal</div>
            <h2 className="mt-2 text-2xl font-semibold">Abrir flujo completo en Mesa 12</h2>
            <p className="mt-3 text-slate-300">Incluye experiencia cliente, kitchen display, panel de sala, inventario, compras y analítica.</p>
          </Link>
          <div className="rounded-[28px] border border-white/10 bg-white/5 p-6">
            <div className="text-sm uppercase tracking-[0.22em] text-slate-400">Documentación</div>
            <ul className="mt-3 space-y-2 text-slate-200">
              <li>• docs/restaurant-saas/architecture.md</li>
              <li>• docs/restaurant-saas/data-model.md</li>
              <li>• docs/restaurant-saas/flows.md</li>
              <li>• UI_EVIDENCE.md</li>
            </ul>
          </div>
        </div>
      </div>
    </main>
  )
}
