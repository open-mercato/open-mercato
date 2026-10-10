import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { RentalContractEditForm } from '../../../../../components/RentalContractForm'

export default async function RentalContractEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Page>
      <PageBody>
        <RentalContractEditForm id={id} />
      </PageBody>
    </Page>
  )
}
