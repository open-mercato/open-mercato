"use client"

import * as React from 'react'
import { useParams, useRouter } from 'next/navigation'
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
export default function AgenticTaskDetailBridgePage() {
  const router = useRouter()
  const params = useParams<{ id?: string | string[] }>()
  const t = useT()
  const rawId = params?.id
  const id = Array.isArray(rawId) ? rawId[0] : rawId

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
