import { headers } from 'next/headers'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { resolvePortalRequestOrigin } from '../../../lib/portalUrl'
import { resolveCurrentOrgPortalSlug } from '../../../lib/portalOrgSlug'
import { PortalUsersPageClient } from './PortalUsersPageClient'

export default async function CustomerAccountsPage() {
  const portalOrigin = resolvePortalRequestOrigin(await headers())
  const portalOrgSlug = await resolveCurrentOrgPortalSlug()
  return (
    <Page>
      <PageBody className="space-y-4">
        <PortalUsersPageClient portalOrigin={portalOrigin} portalOrgSlug={portalOrgSlug} />
      </PageBody>
    </Page>
  )
}
