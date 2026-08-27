import { headers } from 'next/headers'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { resolvePortalRequestOrigin } from '../../../lib/portalUrl'
import { PortalUsersPageClient } from './PortalUsersPageClient'

export default async function CustomerAccountsPage() {
  const portalOrigin = resolvePortalRequestOrigin(await headers())
  return (
    <Page>
      <PageBody className="space-y-4">
        <PortalUsersPageClient portalOrigin={portalOrigin} />
      </PageBody>
    </Page>
  )
}
