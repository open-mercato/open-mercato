import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { SiteFormClient } from '../../../../components/backend/WmsSitesPage'

export default async function WmsSiteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  return (
    <Page>
      <PageBody>
        <SiteFormClient siteId={id} />
      </PageBody>
    </Page>
  )
}
