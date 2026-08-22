import { headers } from 'next/headers'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { resolvePortalRequestOrigin } from '../../../lib/portalUrl'
import { CustomerAccountsSettingsPageClient } from './CustomerAccountsSettingsPageClient'

export default async function CustomerAccountsSettingsPage() {
  const portalOrigin = resolvePortalRequestOrigin(await headers())
  return (
    <Page>
      {/* space-y-6 preserves the gap the page header previously got as a direct <Page> child. */}
      <PageBody className="space-y-6">
        <CustomerAccountsSettingsPageClient portalOrigin={portalOrigin} />
      </PageBody>
    </Page>
  )
}
