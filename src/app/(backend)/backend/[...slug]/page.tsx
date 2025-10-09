import { notFound, redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { findBackendMatch } from '@open-mercato/shared/modules/registry'
import { modules } from '@/generated/modules.generated'
import { getAuthFromCookies } from '@/lib/auth/server'
import { ApplyBreadcrumb } from '@open-mercato/ui/backend/AppShell'
import { createRequestContainer } from '@/lib/di/container'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'

export default async function BackendCatchAll({ params }: { params: Promise<{ slug: string[] }> }) {
  const p = await params
  const pathname = '/backend/' + (p.slug?.join('/') ?? '')
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
    const features = (match.route as any).requireFeatures as string[] | undefined
    if (features && features.length) {
      const container = await createRequestContainer()
      const rbac = container.resolve<any>('rbacService')
      let selectedOrgId: string | null = null
      let allowedOrgIds: string[] | null = null
      try {
        const cookieStore = cookies()
        const cookieSelected = cookieStore.get('om_selected_org')?.value ?? null
        const scope = await resolveOrganizationScopeForRequest({ container, auth, selectedId: cookieSelected })
        selectedOrgId = scope.selectedId ?? null
        allowedOrgIds = scope.allowedIds ?? null
        if (Array.isArray(scope.allowedIds) && scope.allowedIds.length === 0) {
          redirect('/login?requireFeature=' + encodeURIComponent(features.join(',')))
        }
      } catch {
        selectedOrgId = null
        allowedOrgIds = null
      }
      const organizationIdForCheck =
        selectedOrgId
        ?? (auth.orgId && (!Array.isArray(allowedOrgIds) || allowedOrgIds.includes(auth.orgId)) ? auth.orgId : null)
        ?? (Array.isArray(allowedOrgIds) && allowedOrgIds.length ? allowedOrgIds[0] : null)
      const ok = await rbac.userHasAllFeatures(auth.sub, features, { tenantId: auth.tenantId, organizationId: organizationIdForCheck })
      if (!ok) redirect('/login?requireFeature=' + encodeURIComponent(features.join(',')))
    }
  }
  const Component = match.route.Component as any
  return (
    <>
      <ApplyBreadcrumb breadcrumb={(match.route as any).breadcrumb} title={match.route.title as any} />
      <Component params={match.params} />
    </>
  )
}
