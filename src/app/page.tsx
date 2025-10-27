import { getEm } from '@/lib/db/mikro'
import { modules } from '@/generated/modules.generated'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { Tenant, Organization } from '@open-mercato/core/modules/directory/data/entities'
import { StartPageContent } from '@/components/StartPageContent'
import { cookies } from 'next/headers'
import Image from 'next/image'

function FeatureBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded border px-2 py-0.5 text-xs text-muted-foreground">
      {label}
    </span>
  )
}

export default async function Home() {
  // Check if user wants to see the start page
  const cookieStore = await cookies()
  const showStartPageCookie = cookieStore.get('show_start_page')
  const showStartPage = showStartPageCookie?.value !== 'false'

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

  const onboardingAvailable =
    process.env.SELF_SERVICE_ONBOARDING_ENABLED === 'true' &&
    Boolean(process.env.RESEND_API_KEY && process.env.RESEND_API_KEY.trim()) &&
    Boolean(process.env.APP_URL && process.env.APP_URL.trim())

  return (
    <main className="min-h-svh w-full p-8 flex flex-col gap-8">
      <header className="flex flex-col md:flex-row md:items-center gap-4 md:gap-6">
        <Image
          src="/open-mercato.svg"
          alt="Open Mercato"
          width={40}
          height={40}
          className="dark:invert"
          priority
        />
        <div className="flex-1">
          <h1 className="text-3xl font-semibold tracking-tight">Open Mercato</h1>
          <p className="text-sm text-muted-foreground">AI‑supportive, modular ERP foundation for product & service companies</p>
        </div>
      </header>

      <StartPageContent showStartPage={showStartPage} showOnboardingCta={onboardingAvailable} />

      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="rounded-lg border bg-card p-4">
          <div className="text-sm font-medium mb-2">Database Status</div>
          <div className="text-sm text-muted-foreground">Status: <span className="font-medium text-foreground">{dbStatus}</span></div>
          <div className="mt-3 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Users:</span>
              <span className="font-mono font-medium">{usersCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Tenants:</span>
              <span className="font-mono font-medium">{tenantsCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Organizations:</span>
              <span className="font-mono font-medium">{orgsCount}</span>
            </div>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-4 md:col-span-2">
          <div className="text-sm font-medium mb-3">Active Modules</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[200px] overflow-y-auto pr-2">
            {modules.map((m) => {
              const fe = m.frontendRoutes?.length || 0
              const be = m.backendRoutes?.length || 0
              const api = m.apis?.length || 0
              const cli = m.cli?.length || 0
              const i18n = m.translations ? Object.keys(m.translations).length : 0
              return (
                <div key={m.id} className="rounded border p-3 bg-background">
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

      <section className="rounded-lg border bg-card p-4">
        <div className="text-sm font-medium mb-2">Quick Links</div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <a className="underline hover:text-primary transition-colors" href="/login">Login</a>
          <span className="text-muted-foreground">·</span>
          <a className="underline hover:text-primary transition-colors" href="/example">Example Page</a>
          <span className="text-muted-foreground">·</span>
          <a className="underline hover:text-primary transition-colors" href="/backend/example">Example Admin</a>
          <span className="text-muted-foreground">·</span>
          <a className="underline hover:text-primary transition-colors" href="/backend/todos">Example Todos with Custom Fields</a>
          <span className="text-muted-foreground">·</span>
          <a className="underline hover:text-primary transition-colors" href="/blog/123">Example Blog Post</a>
        </div>
      </section>

      <footer className="text-xs text-muted-foreground text-center">
        Built with Next.js, MikroORM, and Awilix — modular by design.
      </footer>
    </main>
  )
}
