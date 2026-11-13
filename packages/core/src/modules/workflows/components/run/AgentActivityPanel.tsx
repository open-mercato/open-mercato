'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { useLiveAgentActions } from './useLiveAgentActions'

/**
 * Live "Agent activity" section for the run detail (workflows spec Phase 2).
 *
 * Renders the append-only stream of agent actions (steps + tool calls) from
 * `useLiveAgentActions` while an INVOKE_AGENT step runs. Ephemeral by design:
 * it shows nothing until the first action arrives and keeps nothing after the
 * run — so it renders `null` when idle and is safe to always mount. No token
 * text (the tool loop uses `generateText`, which does not stream tokens).
 */
export type AgentActivityPanelProps = {
  instanceId?: string | null
  enabled?: boolean
}

export function AgentActivityPanel({ instanceId, enabled = true }: AgentActivityPanelProps) {
  const t = useT()
  const actions = useLiveAgentActions({ instanceId, enabled })

  if (actions.length === 0) return null

  return (
    <section className="rounded-md border border-border p-3" aria-live="polite">
      <h3 className="text-sm font-medium text-foreground">{t('run.agentActivity.title')}</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">{t('run.agentActivity.subtitle')}</p>
      <ul className="mt-2 space-y-1">
        {actions.map((action) => (
          <li key={action.key} className="flex items-center gap-2 text-sm">
            <Badge size="sm">
              {action.kind === 'tool_call'
                ? t('run.agentActivity.toolCall')
                : t('run.agentActivity.step')}
            </Badge>
            <span className="text-muted-foreground">
              {action.name ?? `${t('run.agentActivity.step')} ${action.stepIndex + 1}`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
