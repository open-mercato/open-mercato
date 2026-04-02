import { notFound, redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { findRouteManifestMatch } from '@open-mercato/shared/modules/registry'
import { backendRoutes } from '@/.mercato/generated/backend-routes.generated'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { ApplyBreadcrumb } from '@open-mercato/ui/backend/AppShell'
import { AccessDeniedMessage } from '@open-mercato/ui/backend/detail'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveFeatureCheckContext } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { ComponentReplacementHandles, resolveRegisteredComponent } from '@open-mercato/shared/modules/widgets/component-registry'
import type { Metadata } from 'next'
import { resolveLocalizedTitleMetadata } from '@/lib/metadata'
import { resolvePageMiddlewareRedirect } from '@open-mercato/shared/lib/middleware/page-executor'
import { backendMiddlewareEntries } from '@/.mercato/generated/backend-middleware.generated'

type Awaitable<T> = T | Promise<T>

type BackendParams = { params: Awaitable<{ slug?: string[] }> }

async function renderAccessDenied() {
  const { translate } = await resolveTranslations()
  return (
    <AccessDeniedMessage
      label={translate('auth.accessDenied.title', 'Access Denied')}
      description={translate('auth.accessDenied.message', 'You do not have permission to view this page. Please contact your administrator.')}
      action={
        <Link href="/backend" className="text-sm underline hover:opacity-80">
          {translate('auth.accessDenied.dashboard', 'Go to Dashboard')}
        </Link>
      }
    />
  )
}

export async function generateMetadata(props: BackendParams): Promise<Metadata> {
  const params = await props.params
  const pathname = '/backend/' + (params.slug?.join('/') ?? '')
  const match = findRouteManifestMatch(backendRoutes, pathname)
  if (!match) {
    return {}
  }

  return resolveLocalizedTitleMetadata({
    title: match.route.title,
    titleKey: match.route.titleKey,
  })
}

export default async function BackendCatchAll(props: BackendParams) {
  const params = await props.params
  const pathname = '/backend/' + (params.slug?.join('/') ?? '')
  const match = findRouteManifestMatch(backendRoutes, pathname)
  if (!match) return notFound()
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
      let organizationIdForCheck: string | null = auth.orgId ?? null
      const cookieStore = await cookies()
      const cookieSelected = cookieStore.get('om_selected_org')?.value ?? null
      let tenantIdForCheck: string | null = auth.tenantId ?? null
      try {
        const { organizationId, allowedOrganizationIds, scope } = await resolveFeatureCheckContext({ container: scopeContainer, auth, selectedId: cookieSelected })
        organizationIdForCheck = organizationId
        tenantIdForCheck = scope.tenantId ?? auth.tenantId ?? null
        if (Array.isArray(allowedOrganizationIds) && allowedOrganizationIds.length === 0) {
          return renderAccessDenied()
        }
      } catch {
        organizationIdForCheck = auth.orgId ?? null
        tenantIdForCheck = auth.tenantId ?? null
      }
      const ok = await rbac.userHasAllFeatures(auth.sub, features, { tenantId: tenantIdForCheck, organizationId: organizationIdForCheck })
      if (!ok) return renderAccessDenied()
    }
  }
  const middlewareRedirect = await resolvePageMiddlewareRedirect({
    entries: backendMiddlewareEntries,
    context: {
      pathname,
      mode: 'backend',
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
  const pageHandle = ComponentReplacementHandles.page(pathname)
  const LoadedComponent = await match.route.load()
  const Component = resolveRegisteredComponent(pageHandle, LoadedComponent)

  return (
    <>
      <ApplyBreadcrumb breadcrumb={match.route.breadcrumb} title={match.route.title} titleKey={match.route.titleKey} />
      <div data-component-handle={pageHandle}>
        <Component params={match.params} />
      </div>
    </>
  )
}

export const dynamic = 'force-dynamic'
