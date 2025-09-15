import { Button } from '@/components/ui/button'
import { getEm } from '@/lib/db/mikro'
import { modules } from '@/generated/modules.generated'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { Tenant, Organization } from '@open-mercato/core/modules/directory/data/entities'

function FeatureBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded border px-2 py-0.5 text-xs text-muted-foreground">
      {label}
    </span>
  )
}

export default async function Home() {
  // Database status and counts
  let dbStatus = 'Unknown'
  let usersCount = 0
  let tenantsCount = 0
  let orgsCount = 0
  try {
    const em = await getEm()
    usersCount = await em.count(User, {})
    tenantsCount = await em.count(Tenant, {})
    orgsCount = await em.count(Organization, {})
    dbStatus = 'Connected'
  } catch (e: any) {
    dbStatus = `Error: ${e?.message ?? 'no connection'}`
  }

  return (
    <main className="min-h-svh w-full p-8 flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Open Mercato</h1>
        <p className="text-sm text-muted-foreground">AI‑supportive, modular ERP foundation for product & service companies</p>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="rounded-lg border p-4">
          <div className="text-sm font-medium mb-2">Database</div>
          <div className="text-sm text-muted-foreground">Status: <span className="font-medium text-foreground">{dbStatus}</span></div>
          <div className="mt-2 text-sm">
            <div>Users: <span className="font-mono">{usersCount}</span></div>
            <div>Tenants: <span className="font-mono">{tenantsCount}</span></div>
            <div>Organizations: <span className="font-mono">{orgsCount}</span></div>
          </div>
        </div>

        <div className="rounded-lg border p-4 md:col-span-2">
          <div className="text-sm font-medium mb-3">Modules</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {modules.map((m) => {
              const fe = m.frontendRoutes?.length || 0
              const be = m.backendRoutes?.length || 0
              const api = m.apis?.length || 0
              const cli = m.cli?.length || 0
              const i18n = m.translations ? Object.keys(m.translations).length : 0
              return (
                <div key={m.id} className="rounded border p-3">
                  <div className="text-sm font-medium">{m.info?.title || m.id}{m.info?.version ? <span className="ml-2 text-xs text-muted-foreground">v{m.info.version}</span> : null}</div>
                  {m.info?.description ? <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{m.info.description}</div> : null}
                  <div className="mt-2 flex flex-wrap gap-1">
                    {fe ? <FeatureBadge label={`FE:${fe}`} /> : null}
                    {be ? <FeatureBadge label={`BE:${be}`} /> : null}
                    {api ? <FeatureBadge label={`API:${api}`} /> : null}
                    {cli ? <FeatureBadge label={`CLI:${cli}`} /> : null}
                    {i18n ? <FeatureBadge label={`i18n:${i18n}`} /> : null}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <section className="rounded-lg border p-4">
        <div className="text-sm font-medium mb-2">Quick Links</div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <a className="underline" href="/login">Login</a>
          <span className="text-muted-foreground">·</span>
          <a className="underline" href="/example">Example Page</a>
          <span className="text-muted-foreground">·</span>
          <a className="underline" href="/backend/example">Example Admin</a>
          <span className="text-muted-foreground">·</span>
          <a className="underline" href="/backend/todos">Example Todos with Custom Fields</a>
          <span className="text-muted-foreground">·</span>
          <a className="underline" href="/blog/123">Example Blog Post</a>
        </div>
      </section>

      <footer className="text-xs text-muted-foreground">
        Built with Next.js, MikroORM, and Awilix — modular by design.
      </footer>
    </main>
  )
}
