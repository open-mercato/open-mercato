import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { EntryCreateForm } from '../../../../components/FinancialEntryForm'

export default function FinancialEntryCreatePage() {
  return (
    <Page>
      <PageBody>
        <EntryCreateForm />
      </PageBody>
    </Page>
  )
}
