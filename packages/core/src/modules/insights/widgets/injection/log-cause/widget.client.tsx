"use client"

import * as React from 'react'
import { MessageCircleQuestion } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { LinkButton } from '@open-mercato/ui/primitives/link-button'
import { LogCausePanel } from '../../../components/LogCausePanel'
import { readContextId } from '../../../lib/client/context'

export type LogCauseContext = {
  logId?: unknown
  resourceKind?: unknown
  resourceId?: unknown
}

function LogCauseDisclosure({ logId }: { logId: string }) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const panelId = `insights-log-cause-${logId}`
  return (
    <div className="space-y-2">
      <LinkButton
        type="button"
        size="sm"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        data-testid="insights-log-cause-trigger"
      >
        <MessageCircleQuestion className="size-3" aria-hidden="true" />
        {open ? t('insights.why.log.hide') : t('insights.why.log.trigger')}
      </LinkButton>
      {open ? (
        <div id={panelId}>
          <LogCausePanel logId={logId} />
        </div>
      ) : null}
    </div>
  )
}

export default function LogCauseWidget({ context }: InjectionWidgetComponentProps<LogCauseContext>) {
  const logId = readContextId(context, 'logId')
  if (!logId) return null
  return <LogCauseDisclosure key={logId} logId={logId} />
}
