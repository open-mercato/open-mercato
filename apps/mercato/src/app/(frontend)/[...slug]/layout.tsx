import { PortalLayoutShell } from '@open-mercato/ui/portal/PortalLayoutShell'
import { getCustomerAuthFromCookies } from '@open-mercato/core/modules/customer_accounts/lib/customerAuthServer'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { CustomerUser } from '@open-mercato/core/modules/customer_accounts/data/entities'
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
 * For portal routes, resolves auth + org + user profile SERVER-SIDE
 * from cookies and DB — identical to the backend layout pattern.
 * All data is in the HTML from frame 1. Zero client-side loading states.
 */
export default async function FrontendLayout({ children, params }: LayoutProps) {
  const { slug } = await params
  const pathname = '/' + (slug?.join('/') ?? '')

  const portalMatch = pathname.match(/^\/([^/]+)\/portal(?:\/|$)/)
  if (!portalMatch) {
    return <>{children}</>
  }

  const orgSlug = portalMatch[1]
  const isPublic = isPublicPortalRoute(pathname)

  // Server-side: read customer JWT from cookie
  const customerAuth = await getCustomerAuthFromCookies()

  let orgName: string | null = null
  let tenantId: string | null = null
  let organizationId: string | null = null
  let userName: string | null = null
  let userEmail: string | null = null

  try {
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager

    // Server-side: resolve org by slug (single PK-like query)
    const org = await em.findOne(Organization, { slug: orgSlug, deletedAt: null })
    if (org) {
      orgName = org.name
      organizationId = String(org.id)
      const tenant = (org as any).tenant
      tenantId = typeof tenant === 'string' ? tenant : tenant?.id ? String(tenant.id) : null
    }

    // Server-side: resolve user profile by ID from JWT (single PK query)
    // This gives us the authoritative displayName — no client-side blink
    if (customerAuth) {
      const user = await em.findOne(CustomerUser, { id: customerAuth.sub } as any)
      if (user) {
        userName = user.displayName || customerAuth.email
        userEmail = user.email || customerAuth.email
      } else {
        userName = customerAuth.displayName || customerAuth.email
        userEmail = customerAuth.email
      }
    }
  } catch {
    // Fallback to JWT data
    if (customerAuth) {
      userName = customerAuth.displayName || customerAuth.email
      userEmail = customerAuth.email
    }
  }

  return (
    <PortalLayoutShell
      orgSlug={orgSlug}
      organizationName={orgName}
      tenantId={tenantId}
      organizationId={organizationId}
      authenticated={!isPublic && !!customerAuth}
      userName={userName}
      userEmail={userEmail}
      customerAuth={customerAuth}
    >
      {children}
    </PortalLayoutShell>
  )
}
