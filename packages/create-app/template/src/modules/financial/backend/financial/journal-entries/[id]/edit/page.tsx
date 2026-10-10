import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { EntryEditForm } from '../../../../../components/FinancialEntryForm'

export default async function FinancialEntryEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Page>
      <PageBody>
        <EntryEditForm id={id} />
      </PageBody>
    </Page>
  )
}
