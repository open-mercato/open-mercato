"use client"

import * as React from 'react'
import { CirclePause, Zap } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import type { XrayDraftSummary as XrayDraftSummaryView } from '../../lib/client/xray/draft'
import { formatActivityKey } from '../../lib/client/xray/format'
import type { XrayDraftCommand } from '../../lib/client/xray/types'

export type XrayDraftSummaryProps = {
  summary: XrayDraftSummaryView
  commands?: XrayDraftCommand[]
  skippedActivities?: string[]
  workflowIdAvailable?: boolean
}

/**
 * The generated workflow before it is created: always disabled and a draft, its trigger and its
 * automated update steps, the commands it would run (and whether the tenant enabled them for
 * workflows), skipped activities and a taken workflow id.
 */
export function XrayDraftSummary({ summary, commands = [], skippedActivities = [], workflowIdAvailable = true }: XrayDraftSummaryProps) {
  const t = useT()
  const disabledCommands = commands.filter((command) => command.enabled === false)
  return (
    <div className="space-y-3 text-sm" data-testid="xray-draft-summary">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{summary.workflowName}</span>
        <span className="font-mono text-xs text-muted-foreground">{summary.workflowId}</span>
        <StatusBadge variant="neutral">
          <CirclePause className="size-3" aria-hidden="true" />
          {t(summary.enabled ? 'insights.xray.ui.draft.enabled' : 'insights.xray.ui.draft.disabled')}
        </StatusBadge>
      </div>
      <p className="text-xs text-muted-foreground">{t('insights.xray.ui.draft.disabledNote')}</p>
      <section className="space-y-1" aria-label={t('insights.xray.ui.draft.triggers')}>
        <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{t('insights.xray.ui.draft.triggers')}</h4>
        {summary.triggers.length === 0 ? (
          <p className="text-muted-foreground">{t('insights.xray.ui.draft.noTrigger')}</p>
        ) : (
          <ul className="space-y-1">
            {summary.triggers.map((trigger, index) => (
              <li key={`${trigger.eventPattern}:${index}`} className="flex items-center gap-2">
                <Zap className="size-4 text-muted-foreground" aria-hidden="true" />
                <span className="font-mono text-xs">{trigger.eventPattern}</span>
                {trigger.conditions > 0 ? (
                  <span className="text-xs text-muted-foreground">{t('insights.xray.ui.draft.conditions', { count: trigger.conditions })}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="space-y-1" aria-label={t('insights.xray.ui.draft.steps')}>
        <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{t('insights.xray.ui.draft.steps')}</h4>
        <ol className="list-decimal space-y-1 pl-5">
          {summary.steps.map((step) => (
            <li key={step.stepId}>
              <span>{step.stepName}</span>
              {step.updates.map((update, index) => (
                <span key={`${update.commandId}:${index}`} className="block text-xs text-muted-foreground">
                  {t('insights.xray.ui.draft.update', { command: update.commandId, fields: update.inputKeys.join(', ') })}
                </span>
              ))}
            </li>
          ))}
        </ol>
      </section>
      {skippedActivities.length > 0 ? (
        <p className="text-xs text-muted-foreground" data-testid="xray-draft-skipped">
          {t('insights.xray.ui.draft.skipped', { activities: skippedActivities.map((key) => formatActivityKey(key, t)).join(', ') })}
        </p>
      ) : null}
      {disabledCommands.length > 0 ? (
        <Alert status="warning" size="default">
          <AlertTitle>{t('insights.xray.ui.draft.commandDisabledTitle')}</AlertTitle>
          <AlertDescription>
            {t('insights.xray.ui.draft.commandDisabled', { commands: disabledCommands.map((command) => command.commandId).join(', ') })}
          </AlertDescription>
        </Alert>
      ) : null}
      {!workflowIdAvailable ? (
        <Alert status="error" size="default" data-testid="xray-draft-id-taken">
          <AlertTitle>{t('insights.xray.ui.draft.idTakenTitle')}</AlertTitle>
          <AlertDescription>{t('insights.xray.ui.draft.idTaken', { id: summary.workflowId })}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
