import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { AiAssistantSettingsPageClient } from '../../../../components/AiAssistantSettingsPageClient'

/**
 * Canonical AI assistant settings route. Renders the Phase 4b override
 * form + per-agent resolution table. Phase 1780-6 introduced the dedicated
 * `/allowlist` page on top of this one; both routes share the same
 * `ai_assistant.settings.manage` feature gate.
 */
export default async function AiAssistantSettingsPage() {
  return (
    <Page>
      <PageBody>
        <AiAssistantSettingsPageClient />
      </PageBody>
    </Page>
  )
}
