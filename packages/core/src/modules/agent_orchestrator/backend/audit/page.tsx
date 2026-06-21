"use client"

import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export default function AgentAuditStubPage() {
  const t = useT()
  return (
    <Page>
      <PageBody>
        <EmptyState
          title={t('agent_orchestrator.overview.needsAttention.title')}
          description={t('agent_orchestrator.overview.emptyDescription')}
        />
      </PageBody>
    </Page>
  )
}
