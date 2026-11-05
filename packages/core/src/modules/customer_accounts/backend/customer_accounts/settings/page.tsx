import { headers } from 'next/headers'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { resolvePortalRequestOrigin } from '../../../lib/portalUrl'
import { resolveCurrentOrgPortalSlug } from '../../../lib/portalOrgSlug'
import { CustomerAccountsSettingsPageClient } from './CustomerAccountsSettingsPageClient'

export default async function CustomerAccountsSettingsPage() {
  const portalOrigin = resolvePortalRequestOrigin(await headers())
  const portalOrgSlug = await resolveCurrentOrgPortalSlug()
  return (
    <Page>
      {/* space-y-6 preserves the gap the page header previously got as a direct <Page> child. */}
      <PageBody className="space-y-6">
        <CustomerAccountsSettingsPageClient portalOrigin={portalOrigin} portalOrgSlug={portalOrgSlug} />
      </PageBody>
    </Page>
  )
}
