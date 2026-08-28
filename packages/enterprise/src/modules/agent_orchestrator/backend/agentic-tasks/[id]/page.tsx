"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { processDefinitionHref, PROCESS_DEFINITIONS_HREF } from '../../processes/definitions/navigation'

/**
 * Bridge route — preserves deep links to a single definition across the
 * `/backend/agentic-tasks/<id>` → `/backend/processes/definitions/<id>` move.
 *
 * @deprecated Link to `/backend/processes/definitions/<id>` instead.
 */
export default function AgenticTaskDetailBridgePage({ params }: { params?: { id?: string } }) {
  const router = useRouter()
  const t = useT()
  // The id arrives on the params prop the /backend/[...slug] catch-all passes
  // down, never from the router hook or a positional slug index (#5600).
  const id = params?.id

  React.useEffect(() => {
    router.replace(id ? processDefinitionHref(id) : PROCESS_DEFINITIONS_HREF)
  }, [id, router])

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
