import { modules } from '@/generated/modules.generated'
import { StartPageContent } from '@/components/StartPageContent'
import { cookies } from 'next/headers'
import Image from 'next/image'
import Link from 'next/link'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'

function FeatureBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded border px-2 py-0.5 text-xs text-muted-foreground">
      {label}
    </span>
  )
}

export default async function Home() {
  const { t } = await resolveTranslations()
  
  // Check if user wants to see the start page
  const cookieStore = await cookies()
  const showStartPageCookie = cookieStore.get('show_start_page')
  const showStartPage = showStartPageCookie?.value !== 'false'

  // Database status and counts
  let dbStatus = t('app.page.dbStatus.unknown', 'Unknown')
  let usersCount = 0
  let tenantsCount = 0
  let orgsCount = 0
  try {
    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')
    usersCount = await em.count('User', {})
    tenantsCount = await em.count('Tenant', {})
    orgsCount = await em.count('Organization', {})
    dbStatus = t('app.page.dbStatus.connected', 'Connected')
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : t('app.page.dbStatus.noConnection', 'no connection')
    dbStatus = t('app.page.dbStatus.error', 'Error: {message}', { message })
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
          alt={t('app.page.logoAlt', 'Open Mercato')}
          width={40}
          height={40}
          className="dark:invert"
          priority
        />
        <div className="flex-1">
          <h1 className="text-3xl font-semibold tracking-tight">{t('app.page.title', 'Open Mercato')}</h1>
          <p className="text-sm text-muted-foreground">{t('app.page.subtitle', 'AI‑supportive, modular ERP foundation for product & service companies')}</p>
        </div>
      </header>

      <StartPageContent showStartPage={showStartPage} showOnboardingCta={onboardingAvailable} />

      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="rounded-lg border bg-card p-4">
          <div className="text-sm font-medium mb-2">{t('app.page.dbStatus.title', 'Database Status')}</div>
          <div className="text-sm text-muted-foreground">{t('app.page.dbStatus.label', 'Status:')} <span className="font-medium text-foreground">{dbStatus}</span></div>
          <div className="mt-3 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('app.page.dbStatus.users', 'Users:')}</span>
              <span className="font-mono font-medium">{usersCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('app.page.dbStatus.tenants', 'Tenants:')}</span>
              <span className="font-mono font-medium">{tenantsCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('app.page.dbStatus.organizations', 'Organizations:')}</span>
              <span className="font-mono font-medium">{orgsCount}</span>
            </div>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-4 md:col-span-2">
          <div className="text-sm font-medium mb-3">{t('app.page.activeModules.title', 'Active Modules')}</div>
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
        <div className="text-sm font-medium mb-2">{t('app.page.quickLinks.title', 'Quick Links')}</div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link className="underline hover:text-primary transition-colors" href="/login">{t('app.page.quickLinks.login', 'Login')}</Link>
          <span className="text-muted-foreground">·</span>
          <Link className="underline hover:text-primary transition-colors" href="/example">{t('app.page.quickLinks.examplePage', 'Example Page')}</Link>
          <span className="text-muted-foreground">·</span>
          <Link className="underline hover:text-primary transition-colors" href="/backend/example">{t('app.page.quickLinks.exampleAdmin', 'Example Admin')}</Link>
          <span className="text-muted-foreground">·</span>
          <Link className="underline hover:text-primary transition-colors" href="/backend/todos">{t('app.page.quickLinks.exampleTodos', 'Example Todos with Custom Fields')}</Link>
          <span className="text-muted-foreground">·</span>
          <Link className="underline hover:text-primary transition-colors" href="/blog/123">{t('app.page.quickLinks.exampleBlog', 'Example Blog Post')}</Link>
        </div>
      </section>

      <footer className="text-xs text-muted-foreground text-center">
        {t('app.page.footer', 'Built with Next.js, MikroORM, and Awilix — modular by design.')}
      </footer>
    </main>
  )
}
