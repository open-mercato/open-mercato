import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { VectorSearchTable } from '../../frontend/components/VectorSearchTable'

export default async function VectorSearchPage() {
  const { t } = await resolveTranslations()
  const apiKeyAvailable = Boolean(process.env.OPENAI_API_KEY)
  const missingKeyMessage = t('vector.messages.missingKey', 'Vector search requires configuring OPENAI_API_KEY.')

  return (
    <Page>
      <PageBody>
        <VectorSearchTable apiKeyAvailable={apiKeyAvailable} missingKeyMessage={missingKeyMessage} />
      </PageBody>
    </Page>
  )
}
