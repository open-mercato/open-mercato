import { notFound, redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { findBackendMatch } from '@open-mercato/shared/modules/registry'
import { modules } from '@/.mercato/generated/modules.generated'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { ApplyBreadcrumb } from '@open-mercato/ui/backend/AppShell'
import { AccessDeniedMessage } from '@open-mercato/ui/backend/detail'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveFeatureCheckContext } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { ComponentReplacementHandles, resolveRegisteredComponent } from '@open-mercato/shared/modules/widgets/component-registry'

type Awaitable<T> = T | Promise<T>

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

export default async function BackendCatchAll(props: { params: Awaitable<{ slug?: string[] }> }) {
  const params = await props.params
  const pathname = '/backend/' + (params.slug?.join('/') ?? '')
  const match = findBackendMatch(modules, pathname)
  if (!match) return notFound()
  if (match.route.requireAuth) {
    const auth = await getAuthFromCookies()
    if (!auth) redirect('/api/auth/session/refresh?redirect=' + encodeURIComponent(pathname))
    const required = match.route.requireRoles || []
    if (required.length) {
      const roles = auth.roles || []
      const ok = required.some(r => roles.includes(r))
      if (!ok) return renderAccessDenied()
    }
    const features = match.route.requireFeatures
    if (features && features.length) {
      const container = await createRequestContainer()
      const rbac = container.resolve('rbacService') as RbacService
      let organizationIdForCheck: string | null = auth.orgId ?? null
      const cookieStore = await cookies()
      const cookieSelected = cookieStore.get('om_selected_org')?.value ?? null
      let tenantIdForCheck: string | null = auth.tenantId ?? null
      try {
        const { organizationId, allowedOrganizationIds, scope } = await resolveFeatureCheckContext({ container, auth, selectedId: cookieSelected })
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
  const pageHandle = ComponentReplacementHandles.page(pathname)
  const Component = resolveRegisteredComponent(pageHandle, match.route.Component)

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
