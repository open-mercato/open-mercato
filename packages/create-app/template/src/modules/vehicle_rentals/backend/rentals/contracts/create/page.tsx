import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { RentalContractCreateForm } from '../../../../components/RentalContractForm'

export default function RentalContractCreatePage() {
  return (
    <Page>
      <PageBody>
        <RentalContractCreateForm />
      </PageBody>
    </Page>
  )
}
