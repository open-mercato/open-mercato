import { notFound, redirect } from 'next/navigation'
import { findFrontendMatch } from '@open-mercato/shared/modules/registry'
import { modules } from '@/generated/modules.generated'
import { getAuthFromCookies } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'

export default async function SiteCatchAll({ params }: { params: Promise<{ slug: string[] }> }) {
  const p = await params
  const pathname = '/' + (p.slug?.join('/') ?? '')
  const match = findFrontendMatch(modules, pathname)
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
      const rbac = container.resolve<RbacService>('rbacService')
      const ok = await rbac.userHasAllFeatures(auth.sub, features, { tenantId: auth.tenantId, organizationId: auth.orgId })
      if (!ok) redirect('/login?requireFeature=' + encodeURIComponent(features.join(',')))
    }
  }
  const Component = match.route.Component
  return <Component params={match.params} />
}
