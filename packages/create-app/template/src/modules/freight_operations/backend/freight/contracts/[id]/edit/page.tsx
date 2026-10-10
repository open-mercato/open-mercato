import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ContractEditForm } from '../../../../../components/FreightContractForm'

export default async function FreightContractEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Page>
      <PageBody>
        <ContractEditForm id={id} />
      </PageBody>
    </Page>
  )
}
