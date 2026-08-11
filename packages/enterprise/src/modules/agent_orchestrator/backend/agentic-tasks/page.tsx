"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { PROCESS_DEFINITIONS_HREF } from '../processes/definitions/navigation'

/**
 * Bridge route — "Agentic Tasks" is now "Process definitions" and lives at
 * `/backend/processes/definitions`. Kept for one release so bookmarks and
 * third-party navigation keep working, then removed.
 *
 * @deprecated Link to `/backend/processes/definitions` instead.
 */
export default function AgenticTasksBridgePage() {
  const router = useRouter()
  const t = useT()

  React.useEffect(() => {
    router.replace(PROCESS_DEFINITIONS_HREF)
  }, [router])

  return (
    <Page>
      <PageBody>
        <LoadingMessage
          label={t('agent_orchestrator.processDefinitions.redirect', 'Opening process definitions…')}
        />
      </PageBody>
    </Page>
  )
}
