'use client'

import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { HistoryList } from './components/HistoryList'

export default function DocumentGenerationHistoryPage() {
  const t = useT()

  return (
    <Page data-testid="document-generators-history-page">
      <PageHeader
        title={t('document_generators.history.title', 'Generation history')}
        description={t(
          'document_generators.history.description',
          'Browse the document generation history for the current organization.',
        )}
      />
      <PageBody>
        <HistoryList />
      </PageBody>
    </Page>
  )
}
