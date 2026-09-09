import { headers } from 'next/headers'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { resolvePortalRequestOrigin } from '../../../../lib/portalUrl'
import { PortalUserDetailPageClient } from './PortalUserDetailPageClient'

export default async function CustomerUserDetailPage({ params }: { params?: { id?: string } }) {
  const portalOrigin = resolvePortalRequestOrigin(await headers())
  return (
    <Page>
      <PageBody className="space-y-6">
        <PortalUserDetailPageClient params={params} portalOrigin={portalOrigin} />
      </PageBody>
    </Page>
  )
}
