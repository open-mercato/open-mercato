"use client"

import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export default function AgentTracesStubPage() {
  const t = useT()
  return (
    <Page>
      <PageBody>
        <EmptyState
          title={t('agent_orchestrator.playground.result.trace')}
          description={t('agent_orchestrator.playground.subtitle')}
        />
      </PageBody>
    </Page>
  )
}
