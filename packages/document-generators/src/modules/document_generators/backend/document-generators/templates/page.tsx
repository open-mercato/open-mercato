'use client'

import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { TemplatesList } from './components/TemplatesList'

export default function DocumentGeneratorTemplatesPage() {
  const t = useT()
  return (
    <Page data-testid="document-generators-templates-page">
      <PageHeader
        title={t('document_generators.page.title', 'Available templates')}
        description={t(
          'document_generators.page.description',
          'Registered document templates available in this application.',
        )}
      />
      <PageBody>
        <TemplatesList />
      </PageBody>
    </Page>
  )
}
