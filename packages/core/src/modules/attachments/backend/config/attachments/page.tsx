import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { AttachmentPartitionSettings } from '../../../components/AttachmentPartitionSettings'
import { AttachmentLibrary } from '../../../components/AttachmentLibrary'
import { isPartitionSettingsLocked } from '../../../lib/partitions'

export default async function AttachmentsConfigurationPage() {
  const partitionsLocked = isPartitionSettingsLocked()
  const { t } = await resolveTranslations()
  const lockedTitle = t('attachments.partitions.locked.title', 'Partition settings locked')
  const lockedDescription = t(
    'attachments.partitions.locked.description',
    'Attachment partitions are managed by environment defaults while demo or onboarding mode is enabled.',
  )
  const lockedHint = t(
    'attachments.partitions.locked.hint',
    'Update the environment variables below to re-enable in-app configuration.',
  )

  return (
    <Page>
      <PageBody className="space-y-10">
        <AttachmentLibrary />
        <section className="space-y-4">
          {partitionsLocked ? (
            <Alert variant="warning">
              <AlertTitle>{lockedTitle}</AlertTitle>
              <AlertDescription>
                {lockedDescription}{' '}
                {lockedHint}{' '}
                <code>DEMO_MODE</code> / <code>SELF_SERVICE_ONBOARDING_ENABLED</code>.
              </AlertDescription>
            </Alert>
          ) : (
            <AttachmentPartitionSettings />
          )}
        </section>
      </PageBody>
    </Page>
  )
}
