'use client'

import * as React from 'react'
import { Handle, Position } from '@xyflow/react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { CampaignStep } from '../lib/engine/types'
import type { CampaignTriggerInput } from '../data/validators'

/**
 * Node shells.
 *
 * All three share one frame so the canvas reads as one system, and none of them carries a
 * status colour: a campaign node is not a status, and the DS status tokens are reserved for
 * things that actually have one.
 */
function NodeShell({
  title,
  subtitle,
  children,
  selected,
  hasSource = true,
  hasTarget = true,
}: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  children?: React.ReactNode
  selected?: boolean
  hasSource?: boolean
  hasTarget?: boolean
}) {
  return (
    <div
      className={[
        'min-w-56 max-w-72 rounded-md border bg-card px-3 py-2 text-left shadow-sm',
        selected ? 'border-primary' : 'border-border',
      ].join(' ')}
    >
      {hasTarget ? <Handle type="target" position={Position.Left} className="!bg-muted-foreground" /> : null}
      <div className="text-sm font-medium text-foreground">{title}</div>
      {subtitle ? <div className="mt-0.5 text-xs text-muted-foreground">{subtitle}</div> : null}
      {children ? <div className="mt-2 space-y-1">{children}</div> : null}
      {hasSource ? <Handle type="source" position={Position.Right} className="!bg-muted-foreground" /> : null}
    </div>
  )
}

export type TriggerNodeData = { trigger: CampaignTriggerInput; labelKey?: string }

export function TriggerNode({ data, selected }: { data: TriggerNodeData; selected?: boolean }) {
  const t = useT()
  const trigger = data.trigger
  const title = trigger.kind === 'event'
    ? t(data.labelKey ?? `marketing_automation.trigger.${trigger.eventId}.label`, trigger.eventId)
    : t('marketing_automation.trigger.schedule.label', 'On a schedule')
  const subtitle = trigger.kind === 'event'
    ? trigger.eventId
    : trigger.scheduleValue

  return <NodeShell title={title} subtitle={subtitle} selected={selected} hasTarget={false} />
}

export type AudienceNodeData = {
  isEveryone: boolean
  summary: string[]
  logic: 'AND' | 'OR' | 'NOT' | null
}

export function AudienceNode({ data, selected }: { data: AudienceNodeData; selected?: boolean }) {
  const t = useT()
  const visible = data.summary.slice(0, 3)
  const hidden = data.summary.length - visible.length

  return (
    <NodeShell
      title={t('marketing_automation.canvas.node.audience.title', 'Audience')}
      subtitle={
        // "Not configured" and "send to everyone" are indistinguishable in storage, so the node
        // says which one this is out loud rather than rendering an empty box.
        data.isEveryone
          ? t('marketing_automation.canvas.node.audience.everyone', 'Everyone the trigger produces')
          : data.logic ?? undefined
      }
      selected={selected}
    >
      {visible.map((line) => (
        <div key={line} className="truncate rounded-sm bg-muted px-2 py-1 text-xs text-muted-foreground">
          {line}
        </div>
      ))}
      {hidden > 0 ? (
        <div className="text-xs text-muted-foreground">
          {t('marketing_automation.canvas.node.audience.moreConditions', '+{count} more').replace('{count}', String(hidden))}
        </div>
      ) : null}
    </NodeShell>
  )
}

export type StepNodeData = { step: CampaignStep; index: number; labelKey?: string }

export function StepNode({ data, selected }: { data: StepNodeData; selected?: boolean }) {
  const t = useT()
  const { step, index } = data
  const title = t(data.labelKey ?? `marketing_automation.step.${step.type}.label`, step.type)
  const ordinal = t('marketing_automation.canvas.node.step.ordinal', 'Step {index}').replace('{index}', String(index + 1))

  const detail = step.type === 'wait'
    ? `${String(step.params.minutes ?? '')} min`
    : typeof step.params.subject === 'string'
      ? step.params.subject
      : null

  return (
    <NodeShell title={title} subtitle={ordinal} selected={selected}>
      {detail ? (
        <div className="truncate rounded-sm bg-muted px-2 py-1 text-xs text-muted-foreground">{detail}</div>
      ) : null}
    </NodeShell>
  )
}

export const campaignNodeTypes = {
  trigger: TriggerNode,
  audience: AudienceNode,
  step: StepNode,
} as const
