import { PortalLayoutShell } from '@open-mercato/ui/portal/PortalLayoutShell'
import { getCustomerAuthFromCookies } from '@open-mercato/core/modules/customer_accounts/lib/customerAuthServer'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import type { EntityManager } from '@mikro-orm/postgresql'

type LayoutProps = {
  children: React.ReactNode
  params: Promise<{ slug: string[] }>
}

const PUBLIC_SUFFIXES = ['/portal/login', '/portal/signup']

function isPublicPortalRoute(pathname: string): boolean {
  if (/^\/[^/]+\/portal\/?$/.test(pathname)) return true
  return PUBLIC_SUFFIXES.some((s) => pathname.endsWith(s))
}

/**
 * Frontend catch-all layout.
 *
 * For portal routes (`/{orgSlug}/portal/*`), resolves auth + org data
 * SERVER-SIDE from cookies and DB — identical to how the backend layout
 * resolves staff auth. This eliminates all client-side loading states
 * and layout flashes.
 *
 * Non-portal routes pass through unwrapped.
 */
export default async function FrontendLayout({ children, params }: LayoutProps) {
  const { slug } = await params
  const pathname = '/' + (slug?.join('/') ?? '')

  // Check if this is a portal route
  const portalMatch = pathname.match(/^\/([^/]+)\/portal(?:\/|$)/)
  if (!portalMatch) {
    // Not a portal route — render children directly
    return <>{children}</>
  }

  const orgSlug = portalMatch[1]
  const isPublic = isPublicPortalRoute(pathname)

  // Server-side auth resolution — reads customer JWT from cookie (fast, no DB)
  const customerAuth = await getCustomerAuthFromCookies()

  // Server-side org resolution — single DB query by slug
  let orgName: string | null = null
  let tenantId: string | null = null
  let organizationId: string | null = null
  try {
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const org = await em.findOne(Organization, { slug: orgSlug, deletedAt: null })
    if (org) {
      orgName = org.name
      organizationId = String(org.id)
      const tenant = (org as any).tenant
      tenantId = typeof tenant === 'string' ? tenant : tenant?.id ? String(tenant.id) : null
    }
  } catch {
    // Silently continue — orgName will be null, PortalShell uses orgSlug as fallback
  }

  return (
    <PortalLayoutShell
      orgSlug={orgSlug}
      organizationName={orgName}
      tenantId={tenantId}
      organizationId={organizationId}
      authenticated={!isPublic && !!customerAuth}
      userName={customerAuth?.displayName || null}
      userEmail={customerAuth?.email || null}
      customerAuth={customerAuth}
    >
      {children}
    </PortalLayoutShell>
  )
}
