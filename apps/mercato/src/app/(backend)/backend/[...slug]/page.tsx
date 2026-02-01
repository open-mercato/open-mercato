import { notFound, redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { findBackendMatch } from '@open-mercato/shared/modules/registry'
import { modules } from '@/.mercato/generated/modules.generated'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { ApplyBreadcrumb } from '@open-mercato/ui/backend/AppShell'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveFeatureCheckContext } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { SettingsPageWrapper } from '@open-mercato/ui/backend/settings'
import { settingsSections, settingsRequiredFeatures, isSettingsPath } from '@open-mercato/core/modules/auth/lib/settings-sections'

type Awaitable<T> = T | Promise<T>

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
      if (!ok) redirect('/login?requireRole=' + encodeURIComponent(required.join(',')))
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
          redirect('/login?requireFeature=' + encodeURIComponent(features.join(',')))
        }
      } catch {
        organizationIdForCheck = auth.orgId ?? null
        tenantIdForCheck = auth.tenantId ?? null
      }
      const ok = await rbac.userHasAllFeatures(auth.sub, features, { tenantId: tenantIdForCheck, organizationId: organizationIdForCheck })
      if (!ok) redirect('/login?requireFeature=' + encodeURIComponent(features.join(',')))
    }
  }
  const Component = match.route.Component
  const shouldWrapInSettings = pathname !== '/backend/settings' && isSettingsPath(pathname)

  if (shouldWrapInSettings) {
    return (
      <>
        <ApplyBreadcrumb breadcrumb={match.route.breadcrumb} title={match.route.title} titleKey={match.route.titleKey} />
        <SettingsPageWrapper
          sections={settingsSections}
          requiredFeatures={settingsRequiredFeatures}
        >
          <Component params={match.params} />
        </SettingsPageWrapper>
      </>
    )
  }

  return (
    <>
      <ApplyBreadcrumb breadcrumb={match.route.breadcrumb} title={match.route.title} titleKey={match.route.titleKey} />
      <Component params={match.params} />
    </>
  )
}

export const dynamic = 'force-dynamic'
