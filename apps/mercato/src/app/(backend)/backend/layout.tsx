import { cookies, headers } from 'next/headers'
import { backendRoutes } from '@/.mercato/generated/backend-routes.generated'
import { findRouteManifestMatch, registerBackendRouteManifests } from '@open-mercato/shared/modules/registry'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { AppShell } from '@open-mercato/ui/backend/AppShell'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { profilePathPrefixes } from '@open-mercato/core/modules/auth/lib/profile-sections'
import { APP_VERSION } from '@open-mercato/shared/lib/version'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { PageInjectionBoundary } from '@open-mercato/ui/backend/injection/PageInjectionBoundary'
import { DemoFeedbackWidget } from '@/components/DemoFeedbackWidget'
import OrganizationSwitcher from '@/components/OrganizationSwitcher'
import { BackendHeaderChrome } from '@/components/BackendHeaderChrome'

registerBackendRouteManifests(backendRoutes)

function collectStaticSettingsPathPrefixes(): string[] {
  const prefixes = new Set<string>()
  for (const route of backendRoutes) {
    if (route.pageContext !== 'settings') continue
    const href = route.pattern ?? route.path ?? ''
    if (!href || href.includes('[')) continue
    const parts = href.split('/')
    const lastSegment = parts[parts.length - 1]
    if (parts.length > 3 && lastSegment !== 'settings') {
      prefixes.add(parts.slice(0, -1).join('/'))
    }
    prefixes.add(href)
  }
  return Array.from(prefixes)
}

export default async function BackendLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ slug?: string[] }>
}) {
  const auth = await getAuthFromCookies()
  const cookieStore = await cookies()
  const headerStore = await headers()

  let path = headerStore.get('x-next-url') ?? ''
  if (path.includes('?')) path = path.split('?')[0]
  let resolvedParams: { slug?: string[] } = {}
  try {
    resolvedParams = await params
  } catch {
    resolvedParams = {}
  }
  if (!path) {
    const slug = resolvedParams.slug ?? []
    path = '/backend' + (Array.isArray(slug) && slug.length > 0 ? `/${slug.join('/')}` : '')
  }

  const { translate, locale, dict } = await resolveTranslations()
  const embeddingConfigured = Boolean(
    process.env.OPENAI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.MISTRAL_API_KEY ||
    process.env.COHERE_API_KEY ||
    process.env.AWS_ACCESS_KEY_ID ||
    process.env.OLLAMA_BASE_URL,
  )
  const missingConfigMessage = translate(
    'search.messages.missingConfig',
    'Search requires configuring an embedding provider for semantic search.',
  )

  const match = findRouteManifestMatch(backendRoutes, path)
  const currentTitle = match?.route.titleKey
    ? translate(match.route.titleKey, match.route.title)
    : (match?.route.title ?? '')
  const rawBreadcrumb = match?.route.breadcrumb
  const breadcrumb = rawBreadcrumb?.map((item) => ({
    ...item,
    label: item.labelKey ? translate(item.labelKey, item.label || item.labelKey) : item.label,
  }))

  const collapsedCookie = cookieStore.get('om_sidebar_collapsed')?.value
  const initialCollapsed = collapsedCookie === '1'
  const demoModeEnabled = parseBooleanWithDefault(process.env.DEMO_MODE, true)
  const deployEnv = process.env.DEPLOY_ENV
  const baseProductName = translate('appShell.productName', 'Open Mercato')
  const productName = deployEnv && deployEnv !== 'local'
    ? `${baseProductName} (${deployEnv.charAt(0).toUpperCase() + deployEnv.slice(1)})`
    : baseProductName

  const injectionContext = {
    path,
    userId: auth?.sub ?? null,
    tenantId: auth?.tenantId ?? null,
    organizationId: auth?.orgId ?? null,
  }

  return (
    <I18nProvider locale={locale} dict={dict}>
      <AppShell
        key={path}
        productName={productName}
        email={auth?.email}
        groups={[]}
        currentTitle={currentTitle}
        breadcrumb={breadcrumb}
        sidebarCollapsedDefault={initialCollapsed}
        rightHeaderSlot={(
          <BackendHeaderChrome
            email={auth?.email}
            embeddingConfigured={embeddingConfigured}
            missingConfigMessage={missingConfigMessage}
            tenantId={auth?.tenantId ?? null}
            organizationId={auth?.orgId ?? null}
          />
        )}
        mobileSidebarSlot={<OrganizationSwitcher compact />}
        adminNavApi="/api/auth/admin/nav"
        version={APP_VERSION}
        settingsPathPrefixes={collectStaticSettingsPathPrefixes()}
        settingsSections={[]}
        settingsSectionTitle={translate('backend.nav.settings', 'Settings')}
        profileSections={[]}
        profileSectionTitle={translate('profile.page.title', 'Profile')}
        profilePathPrefixes={profilePathPrefixes}
      >
        <PageInjectionBoundary path={path} context={injectionContext}>
          {children}
        </PageInjectionBoundary>
        {demoModeEnabled ? <DemoFeedbackWidget demoModeEnabled={demoModeEnabled} /> : null}
      </AppShell>
    </I18nProvider>
  )
}

export const dynamic = 'force-dynamic'
