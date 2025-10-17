import { notFound, redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { findBackendMatch } from '@open-mercato/shared/modules/registry'
import { modules } from '@/generated/modules.generated'
import { getAuthFromCookies } from '@/lib/auth/server'
import { ApplyBreadcrumb } from '@open-mercato/ui/backend/AppShell'
import { createRequestContainer } from '@/lib/di/container'
import { resolveFeatureCheckContext } from '@open-mercato/core/modules/directory/utils/organizationScope'

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
    const features = (match.route as any).requireFeatures as string[] | undefined
    if (features && features.length) {
      const container = await createRequestContainer()
      const rbac = container.resolve<any>('rbacService')
      let organizationIdForCheck: string | null = auth.orgId ?? null
      const cookieStore = await cookies()
      const cookieSelected = cookieStore.get('om_selected_org')?.value ?? null
      try {
        const { organizationId, allowedOrganizationIds } = await resolveFeatureCheckContext({ container, auth, selectedId: cookieSelected })
        organizationIdForCheck = organizationId
        if (Array.isArray(allowedOrganizationIds) && allowedOrganizationIds.length === 0) {
          redirect('/login?requireFeature=' + encodeURIComponent(features.join(',')))
        }
      } catch {
        organizationIdForCheck = auth.orgId ?? null
      }
      const ok = await rbac.userHasAllFeatures(auth.sub, features, { tenantId: auth.tenantId, organizationId: organizationIdForCheck })
      if (!ok) redirect('/login?requireFeature=' + encodeURIComponent(features.join(',')))
    }
  }
  const Component = match.route.Component as any
  return (
    <>
      <ApplyBreadcrumb breadcrumb={(match.route as any).breadcrumb} title={match.route.title as any} titleKey={(match.route as any).titleKey as any} />
      <Component params={match.params} />
    </>
  )
}

export const dynamic = 'force-dynamic'
