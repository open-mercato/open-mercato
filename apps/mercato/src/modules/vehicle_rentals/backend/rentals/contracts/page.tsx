import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import RentalContractsTable from '../../../components/RentalContractsTable'

export default function RentalContractsPage() {
  return (
    <Page>
      <PageBody>
        <RentalContractsTable />
      </PageBody>
    </Page>
  )
}
