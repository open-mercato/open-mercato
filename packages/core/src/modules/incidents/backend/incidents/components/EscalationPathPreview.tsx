"use client"

import * as React from 'react'
import { Clock, Flag, RotateCw, Users } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'

export type EscalationPreviewTarget = {
  type: 'user' | 'team' | 'role'
  id: string
}

export type EscalationPreviewStep = {
  delayMinutes: number
  targets: EscalationPreviewTarget[]
}

type EscalationPathPreviewProps = {
  steps: readonly EscalationPreviewStep[]
  repeatCount: number
  userLabels: Readonly<Record<string, string>>
  roleLabels: Readonly<Record<string, string>>
  teamLabels: Readonly<Record<string, string>>
  className?: string
}

function formatTemplate(
  template: string,
  values: Readonly<Record<string, string | number>>,
): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template,
  )
}

function resolveTargetLabel(
  target: EscalationPreviewTarget,
  userLabels: Readonly<Record<string, string>>,
  roleLabels: Readonly<Record<string, string>>,
  teamLabels: Readonly<Record<string, string>>,
): string {
  if (target.type === 'user') return userLabels[target.id] ?? target.id
  if (target.type === 'role') return roleLabels[target.id] ?? target.id
  return teamLabels[target.id] ?? target.id
}

export function EscalationPathPreview({
  steps,
  repeatCount,
  userLabels,
  roleLabels,
  teamLabels,
  className,
}: EscalationPathPreviewProps) {
  const t = useT()
  const immediatelyLabel = t('incidents.escalation.preview.immediately', 'Immediately')
  const afterMinutesTemplate = t('incidents.escalation.preview.afterMinutes', 'After {minutes} min')
  const noTargetsLabel = t('incidents.escalation.preview.noTargets', 'No targets configured')
  const repeatLabel = repeatCount > 0
    ? formatTemplate(t('incidents.escalation.preview.repeatCount', 'Repeats {count} times'), { count: repeatCount })
    : t('incidents.escalation.preview.repeatCountZero', 'Does not repeat')
  const exhaustedLabel = t('incidents.escalation.preview.exhausted', 'Then escalation is exhausted')

  return (
    <div className={cn('space-y-3', className)}>
      <ol className="space-y-3">
        {steps.map((step, stepIndex) => {
          const timing = step.delayMinutes === 0
            ? immediatelyLabel
            : formatTemplate(afterMinutesTemplate, { minutes: step.delayMinutes })
          return (
            <li key={`preview-step-${stepIndex}`} className="relative pl-8">
              {stepIndex < steps.length - 1 ? (
                <span className="absolute bottom-0 left-3 top-7 border-l border-border" aria-hidden="true" />
              ) : null}
              <span className="absolute left-0 top-0 flex size-6 items-center justify-center rounded-full border border-border bg-background text-muted-foreground">
                <Clock className="size-3" aria-hidden="true" />
              </span>
              <div className="space-y-2 rounded-md border border-border bg-background p-3">
                <p className="text-sm font-medium text-foreground">{timing}</p>
                {step.targets.length > 0 ? (
                  <div className="flex flex-wrap gap-2" aria-label={t('incidents.escalation.preview.targets', 'Targets')}>
                    {step.targets.map((target, targetIndex) => {
                      const label = resolveTargetLabel(target, userLabels, roleLabels, teamLabels)
                      return (
                        <span
                          key={`${target.type}:${target.id}:${targetIndex}`}
                          className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-muted px-2 py-1 text-xs text-foreground"
                          title={label}
                        >
                          <Users className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                          <span className="truncate">{label}</span>
                        </span>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">{noTargetsLabel}</p>
                )}
              </div>
            </li>
          )
        })}
      </ol>
      <div className="space-y-2 pl-8">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <RotateCw className="size-4" aria-hidden="true" />
          <span>{repeatLabel}</span>
        </p>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Flag className="size-4" aria-hidden="true" />
          <span>{exhaustedLabel}</span>
        </p>
      </div>
    </div>
  )
}
