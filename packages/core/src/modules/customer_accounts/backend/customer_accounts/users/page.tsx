import { headers } from 'next/headers'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { resolvePortalRequestOrigin } from '../../../lib/portalUrl'
import { resolveCurrentOrgPortalSlug } from '../../../lib/portalOrgSlug'
import { PortalUsersPageClient } from './PortalUsersPageClient'

export default async function CustomerAccountsPage() {
  const portalOrigin = resolvePortalRequestOrigin(await headers())
  const portalOrgSlug = await resolveCurrentOrgPortalSlug()
  const auth = await getAuthFromCookies().catch(() => null)
  const requireOrganization = !resolveActiveOrganizationId(auth)
  return (
    <Page>
      <PageBody className="space-y-4">
        <PortalUsersPageClient
          portalOrigin={portalOrigin}
          portalOrgSlug={portalOrgSlug}
          requireOrganization={requireOrganization}
        />
      </PageBody>
    </Page>
  )
}
