import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { VendorEditForm } from '../../../../../../components/VendorForm'

export default async function VendorEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Page>
      <PageBody>
        <VendorEditForm id={id} />
      </PageBody>
    </Page>
  )
}
