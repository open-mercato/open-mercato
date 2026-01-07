import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { VectorSettingsPageClient } from '../../../frontend/components/VectorSettingsPageClient'

export default async function VectorSettingsPage() {
  const { t } = await resolveTranslations()
  const statusTitle = t('vector.settings.statusTitle', 'Vector search status')
  const statusEnabledMessage = t('vector.settings.statusEnabled', 'Embedding provider configured. Vector search is available.')
  const statusDisabledMessage = t('vector.settings.statusDisabled', 'Embedding provider not configured. Vector search is disabled.')
  const autoIndexingLabel = t('vector.settings.autoIndexingLabel', 'Index database changes automatically')
  const autoIndexingDescription = t(
    'vector.settings.autoIndexingDescription',
    'Keep vector embeddings in sync whenever records change.',
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

  const embeddingProviderTitle = t('vector.settings.embeddingProviderTitle', 'Embedding Provider')
  const embeddingProviderLabel = t('vector.settings.embeddingProviderLabel', 'Provider')
  const embeddingModelLabel = t('vector.settings.embeddingModelLabel', 'Model')
  const embeddingDimensionLabel = t('vector.settings.embeddingDimensionLabel', 'Dimension')
  const embeddingNotConfiguredLabel = t('vector.settings.embeddingNotConfigured', 'not configured')
  const embeddingCustomModelOption = t('vector.settings.embeddingCustomModelOption', 'Custom...')
  const embeddingCustomModelNameLabel = t('vector.settings.embeddingCustomModelNameLabel', 'Model Name')
  const embeddingCustomDimensionLabel = t('vector.settings.embeddingCustomDimensionLabel', 'Dimensions')
  const embeddingChangeWarningTitle = t('vector.settings.embeddingChangeWarningTitle', 'Warning: This change requires full reindexing')
  const embeddingChangeWarningDescription = t(
    'vector.settings.embeddingChangeWarningDescription',
    'Changing the embedding provider or model will require rebuilding all vector embeddings.',
  )
  const embeddingChangeWarningBullet1 = t('vector.settings.embeddingChangeWarningBullet1', 'Delete ALL existing vector embeddings')
  const embeddingChangeWarningBullet2 = t('vector.settings.embeddingChangeWarningBullet2', 'Drop and recreate the vector_search table')
  const embeddingChangeWarningBullet3 = t('vector.settings.embeddingChangeWarningBullet3', 'Require regenerating embeddings for all indexed records')
  const embeddingChangeWarningNote = t(
    'vector.settings.embeddingChangeWarningNote',
    'Vector search will be unavailable until reindexing completes.',
  )
  const embeddingCancelLabel = t('vector.settings.embeddingCancelLabel', 'Cancel')
  const embeddingConfirmLabel = t('vector.settings.embeddingConfirmLabel', 'Confirm & Apply')
  const embeddingProviderSuccessMessage = t('vector.settings.embeddingProviderSuccess', 'Embedding provider updated successfully.')
  const embeddingProviderErrorMessage = t('vector.settings.embeddingProviderError', 'Failed to update embedding provider.')

  const reindexTitle = t('vector.settings.reindexTitle', 'Reindex Vector Data')
  const reindexDescription = t('vector.settings.reindexDescription', 'Regenerate embeddings for all indexed records using the current provider.')
  const reindexButton = t('vector.settings.reindexButton', 'Reindex All')
  const reindexWarning = t('vector.settings.reindexWarning', 'This will make API calls to your embedding provider, which may incur costs depending on your plan.')
  const reindexConfirmTitle = t('vector.settings.reindexConfirmTitle', 'Confirm Reindex')
  const reindexConfirmDescription = t('vector.settings.reindexConfirmDescription', 'This will regenerate embeddings for all indexed records.')
  const reindexConfirmButton = t('vector.settings.reindexConfirmButton', 'Start Reindex')
  const reindexSuccessMessage = t('vector.settings.reindexSuccess', 'Reindex started successfully.')
  const reindexErrorMessage = t('vector.settings.reindexError', 'Failed to start reindex.')
  const reindexingLabel = t('vector.settings.reindexing', 'Reindexing…')

  return (
    <Page>
      <PageBody>
        <VectorSettingsPageClient
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
          embeddingProviderTitle={embeddingProviderTitle}
          embeddingProviderLabel={embeddingProviderLabel}
          embeddingModelLabel={embeddingModelLabel}
          embeddingDimensionLabel={embeddingDimensionLabel}
          embeddingNotConfiguredLabel={embeddingNotConfiguredLabel}
          embeddingCustomModelOption={embeddingCustomModelOption}
          embeddingCustomModelNameLabel={embeddingCustomModelNameLabel}
          embeddingCustomDimensionLabel={embeddingCustomDimensionLabel}
          embeddingChangeWarningTitle={embeddingChangeWarningTitle}
          embeddingChangeWarningDescription={embeddingChangeWarningDescription}
          embeddingChangeWarningBullet1={embeddingChangeWarningBullet1}
          embeddingChangeWarningBullet2={embeddingChangeWarningBullet2}
          embeddingChangeWarningBullet3={embeddingChangeWarningBullet3}
          embeddingChangeWarningNote={embeddingChangeWarningNote}
          embeddingCancelLabel={embeddingCancelLabel}
          embeddingConfirmLabel={embeddingConfirmLabel}
          embeddingProviderSuccessMessage={embeddingProviderSuccessMessage}
          embeddingProviderErrorMessage={embeddingProviderErrorMessage}
          reindexTitle={reindexTitle}
          reindexDescription={reindexDescription}
          reindexButton={reindexButton}
          reindexWarning={reindexWarning}
          reindexConfirmTitle={reindexConfirmTitle}
          reindexConfirmDescription={reindexConfirmDescription}
          reindexConfirmButton={reindexConfirmButton}
          reindexSuccessMessage={reindexSuccessMessage}
          reindexErrorMessage={reindexErrorMessage}
          reindexingLabel={reindexingLabel}
        />
      </PageBody>
    </Page>
  )
}
