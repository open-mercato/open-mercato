import { headers } from 'next/headers'
import Link from 'next/link'
import { PortalLayoutShell } from '@open-mercato/ui/portal/PortalLayoutShell'
import { getCustomerAuthFromCookies } from '@open-mercato/core/modules/customer_accounts/lib/customerAuthServer'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { CustomerUser } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { FeatureTogglesService } from '@open-mercato/core/modules/feature_toggles/lib/feature-flag-check'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { AccessDeniedMessage } from '@open-mercato/ui/backend/detail'
import type { EntityManager } from '@mikro-orm/postgresql'

type LayoutProps = {
  children: React.ReactNode
}

const PUBLIC_SUFFIXES = ['/portal/login', '/portal/signup', '/portal/verify', '/portal/reset-password']

function isPublicPortalRoute(pathname: string): boolean {
  if (/^\/[^/]+\/portal\/?$/.test(pathname)) return true
  return PUBLIC_SUFFIXES.some((s) => pathname.endsWith(s))
}

function getOrganizationTenantId(org: Organization): string | null {
  const tenant = (org as any).tenant
  return typeof tenant === 'string' ? tenant : tenant?.id ? String(tenant.id) : null
}

async function renderPortalAccessDenied() {
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

// Sits ABOVE the [...slug] dynamic segment so portal navigation does not
// remount the client subtree. Pathname comes from middleware via x-next-url.
export default async function FrontendLayout({ children }: LayoutProps) {
  const headerStore = await headers()
  let pathname = headerStore.get('x-next-url') ?? '/'
  if (pathname.includes('?')) pathname = pathname.split('?')[0]

  const portalMatch = pathname.match(/^\/([^/]+)\/portal(?:\/|$)/)
  if (!portalMatch) {
    return <>{children}</>
  }

  const orgSlug = portalMatch[1]
  const isPublic = isPublicPortalRoute(pathname)

  const customerAuth = await getCustomerAuthFromCookies()

  let orgName: string | null = null
  let tenantId: string | null = null
  let organizationId: string | null = null
  let userName: string | null = null
  let userEmail: string | null = null
  let portalEnabled = true
  let portalAccessDenied = false
  let customerAuthMatchesUrlOrg = false

  try {
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager

    const authOrg = customerAuth
      ? await em.findOne(Organization, {
          id: customerAuth.orgId,
          slug: orgSlug,
          deletedAt: null,
        } as any)
      : null
    customerAuthMatchesUrlOrg = !!customerAuth
      && !!authOrg
      && String(authOrg.id) === customerAuth.orgId

    const org = customerAuthMatchesUrlOrg
      ? authOrg
      : (!customerAuth || isPublic)
        ? await em.findOne(Organization, { slug: orgSlug, deletedAt: null }, { populate: ['tenant'] })
        : null

    if (org) {
      orgName = org.name
      organizationId = String(org.id)
      tenantId = customerAuthMatchesUrlOrg && customerAuth ? customerAuth.tenantId : getOrganizationTenantId(org)
    }

    if (customerAuth && !isPublic && !customerAuthMatchesUrlOrg) {
      portalAccessDenied = true
    }

    if (!portalAccessDenied && tenantId) {
      const featureTogglesService = container.resolve('featureTogglesService') as FeatureTogglesService
      const result = await featureTogglesService.getBoolConfig('portal_enabled', tenantId)
      if (result.ok && result.value === false) {
        portalEnabled = false
      }
    }

    if (!portalAccessDenied && customerAuthMatchesUrlOrg && customerAuth) {
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
    if (customerAuth && !isPublic && !organizationId) {
      portalAccessDenied = true
    }
    if (!portalAccessDenied && customerAuthMatchesUrlOrg && customerAuth) {
      userName = customerAuth.displayName || customerAuth.email
      userEmail = customerAuth.email
    }
  }

  if (portalAccessDenied) {
    return renderPortalAccessDenied()
  }

  if (!portalEnabled) {
    const { t } = await resolveTranslations()
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
        <div className="rounded-xl border bg-card p-6 text-center sm:p-8">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            {t('portal.disabled.title', 'Portal Not Available')}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('portal.disabled.description', 'The customer portal has been disabled by the administrator. Please contact your organization for more information.')}
          </p>
        </div>
      </div>
    )
  }

  return (
    <PortalLayoutShell
      orgSlug={orgSlug}
      organizationName={orgName}
      tenantId={tenantId}
      organizationId={organizationId}
      authenticated={!isPublic && customerAuthMatchesUrlOrg}
      userName={userName}
      userEmail={userEmail}
      customerAuth={customerAuthMatchesUrlOrg ? customerAuth : null}
    >
      {children}
    </PortalLayoutShell>
  )
}
