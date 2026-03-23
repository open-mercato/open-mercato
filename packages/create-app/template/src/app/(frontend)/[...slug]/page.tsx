import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { findFrontendMatch } from '@open-mercato/shared/modules/registry'
import { modules } from '@/.mercato/generated/modules.generated'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { AccessDeniedMessage } from '@open-mercato/ui/backend/detail'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { hasAllFeatures } from '@open-mercato/shared/lib/auth/featureMatch'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { Metadata } from 'next'
import { resolveLocalizedTitleMetadata } from '@/lib/metadata'
import { resolvePageMiddlewareRedirect } from '@open-mercato/shared/lib/middleware/page-executor'
import { frontendMiddlewareEntries } from '@/.mercato/generated/frontend-middleware.generated'

type FrontendParams = { params: Promise<{ slug: string[] }> }

async function renderAccessDenied() {
  const { translate } = await resolveTranslations()
  return (
    <AccessDeniedMessage
      label={translate('auth.accessDenied.title', 'Access Denied')}
      description={translate('auth.accessDenied.message', 'You do not have permission to view this page. Please contact your administrator.')}
      action={
        <Link href="/" className="text-sm underline hover:opacity-80">
          {translate('auth.accessDenied.home', 'Go to Home')}
        </Link>
      }
    />
  )
}

export async function generateMetadata({ params }: FrontendParams): Promise<Metadata> {
  const p = await params
  const pathname = '/' + (p.slug?.join('/') ?? '')
  const match = findFrontendMatch(modules, pathname)
  if (!match) {
    return {}
  }

  return resolveLocalizedTitleMetadata({
    title: match.route.title,
    titleKey: match.route.titleKey,
  })
}

export default async function SiteCatchAll({ params }: FrontendParams) {
  const p = await params
  const pathname = '/' + (p.slug?.join('/') ?? '')
  const match = findFrontendMatch(modules, pathname)
  if (!match) return notFound()

  // Customer portal auth gate — separate from staff auth
  if (match.route.requireCustomerAuth) {
    const { getCustomerAuthFromCookies } = await import('@open-mercato/core/modules/customer_accounts/lib/customerAuthServer')
    const customerAuth = await getCustomerAuthFromCookies()
    if (!customerAuth) {
      // Extract orgSlug from pathname for redirect (e.g., /my-org/portal/orders → my-org)
      const segments = pathname.split('/').filter(Boolean)
      const orgSlug = segments[0] ?? ''
      redirect(`/${orgSlug}/portal/login`)
    }
    const customerFeatures = match.route.requireCustomerFeatures
    if (customerFeatures && customerFeatures.length) {
      const ok = hasAllFeatures(customerFeatures as string[], customerAuth.resolvedFeatures)
      if (!ok) return renderAccessDenied()
    }
    const Component = match.route.Component
    return <Component params={match.params} />
  }

  // Staff auth gate
  let auth: AuthContext = null
  let container: Awaited<ReturnType<typeof createRequestContainer>> | null = null
  const ensureContainer = async () => {
    if (!container) {
      container = await createRequestContainer()
    }
    return container
  }
  if (match.route.requireAuth) {
    auth = await getAuthFromCookies()
    if (!auth) redirect('/api/auth/session/refresh?redirect=' + encodeURIComponent(pathname))
    const required = match.route.requireRoles || []
    if (required.length) {
      const roles = auth.roles || []
      const ok = required.some(r => roles.includes(r))
      if (!ok) return renderAccessDenied()
    }
    const features = match.route.requireFeatures
    if (features && features.length) {
      const scopeContainer = await ensureContainer()
      const rbac = scopeContainer.resolve('rbacService') as RbacService
      const ok = await rbac.userHasAllFeatures(auth.sub, features, { tenantId: auth.tenantId, organizationId: auth.orgId })
      if (!ok) return renderAccessDenied()
    }
  }
  const middlewareRedirect = await resolvePageMiddlewareRedirect({
    entries: frontendMiddlewareEntries,
    context: {
      pathname,
      mode: 'frontend',
      routeMeta: {
        requireAuth: match.route.requireAuth,
        requireRoles: match.route.requireRoles,
        requireFeatures: match.route.requireFeatures,
      },
      auth,
      ensureContainer,
    },
  })
  if (middlewareRedirect) redirect(middlewareRedirect)
  const Component = match.route.Component
  return <Component params={match.params} />
}
