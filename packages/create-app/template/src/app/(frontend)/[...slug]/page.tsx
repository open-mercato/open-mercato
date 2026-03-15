import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { findFrontendMatch } from '@open-mercato/shared/modules/registry'
import { modules } from '@/.mercato/generated/modules.generated'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { AccessDeniedMessage } from '@open-mercato/ui/backend/detail'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { Metadata } from 'next'
import { resolveLocalizedTitleMetadata } from '@/lib/metadata'

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
      const ok = await rbac.userHasAllFeatures(auth.sub, features, { tenantId: auth.tenantId, organizationId: auth.orgId })
      if (!ok) return renderAccessDenied()
    }
  }
  const Component = match.route.Component
  return <Component params={match.params} />
}
