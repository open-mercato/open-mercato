import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { VectorSearchPageClient } from '../../frontend/components/VectorSearchPageClient'

export default async function VectorSearchPage() {
  const { t } = await resolveTranslations()
  const missingKeyMessage = t('vector.messages.missingKey', 'Vector search requires configuring OPENAI_API_KEY.')
  const statusTitle = t('vector.settings.statusTitle', 'Vector search status')
  const statusEnabledMessage = t('vector.settings.statusEnabled', 'OpenAI API key detected. Vector search is available.')
  const statusDisabledMessage = t('vector.settings.statusDisabled', 'OpenAI API key missing. Vector search is disabled.')
  const autoIndexingLabel = t('vector.settings.autoIndexingLabel', 'Index database changes automatically')
  const autoIndexingDescription = t(
    'vector.settings.autoIndexingDescription',
    'When enabled, query index events automatically refresh vector embeddings.',
  )
  const autoIndexingLockedMessage = t(
    'vector.settings.autoIndexingLocked',
    'Auto-indexing is locked by the DISABLE_VECTOR_SEARCH_AUTOINDEXING environment flag.',
  )
  const toggleSuccessMessage = t('vector.settings.toggleSuccess', 'Auto-indexing preference saved.')
  const toggleErrorMessage = t('vector.settings.toggleError', 'Failed to update auto-indexing preference.')
  const refreshLabel = t('vector.settings.refresh', 'Refresh status')
  const savingLabel = t('vector.settings.saving', 'Saving…')
  const loadingLabel = t('vector.settings.loading', 'Loading settings…')

  return (
    <Page>
      <PageBody>
        <VectorSearchPageClient
          missingKeyMessage={missingKeyMessage}
          statusTitle={statusTitle}
          statusEnabledMessage={statusEnabledMessage}
          statusDisabledMessage={statusDisabledMessage}
          autoIndexingLabel={autoIndexingLabel}
          autoIndexingDescription={autoIndexingDescription}
          autoIndexingLockedMessage={autoIndexingLockedMessage}
          toggleSuccessMessage={toggleSuccessMessage}
          toggleErrorMessage={toggleErrorMessage}
          refreshLabel={refreshLabel}
          savingLabel={savingLabel}
          loadingLabel={loadingLabel}
        />
      </PageBody>
    </Page>
  )
}
