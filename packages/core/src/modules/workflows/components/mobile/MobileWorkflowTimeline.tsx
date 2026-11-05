'use client'

import { useT } from '@open-mercato/shared/lib/i18n/context'
import { NODE_TYPE_ICONS, type NodeType } from '../../lib/node-type-icons'
import { CheckCircle2, Circle, AlertCircle, Loader2 } from 'lucide-react'

export interface TimelineStep {
  id: string
  label: string
  type: string
  status: 'completed' | 'active' | 'pending' | 'failed' | 'skipped'
  duration?: string | null
}

interface MobileWorkflowTimelineProps {
  steps: TimelineStep[]
}

const STATUS_CONFIG = {
  completed: {
    borderColor: 'border-l-status-success-border',
    bgColor: 'bg-status-success-bg',
    icon: CheckCircle2,
    iconColor: 'text-status-success-icon',
    dotColor: 'bg-status-success-icon',
  },
  active: {
    borderColor: 'border-l-status-info-border',
    bgColor: 'bg-status-info-bg',
    icon: Loader2,
    iconColor: 'text-status-info-icon',
    dotColor: 'bg-status-info-icon',
  },
  pending: {
    borderColor: 'border-l-status-neutral-border',
    bgColor: 'bg-status-neutral-bg',
    icon: Circle,
    iconColor: 'text-status-neutral-icon',
    dotColor: 'bg-status-neutral-icon',
  },
  failed: {
    borderColor: 'border-l-status-error-border',
    bgColor: 'bg-status-error-bg',
    icon: AlertCircle,
    iconColor: 'text-status-error-icon',
    dotColor: 'bg-status-error-icon',
  },
  skipped: {
    borderColor: 'border-l-status-warning-border',
    bgColor: 'bg-status-warning-bg',
    icon: Circle,
    iconColor: 'text-status-warning-icon',
    dotColor: 'bg-status-warning-icon',
  },
} as const

export function MobileWorkflowTimeline({ steps }: MobileWorkflowTimelineProps) {
  const t = useT()

  if (steps.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        {t('workflows.mobile.noSteps', 'No steps defined yet.')}
      </p>
    )
  }

  return (
    <div className="space-y-0">
      {steps.map((step, idx) => {
        const config = STATUS_CONFIG[step.status]
        const StatusIcon = config.icon
        const NodeIcon = NODE_TYPE_ICONS[step.type as NodeType] || Circle
        const isLast = idx === steps.length - 1

        return (
          <div key={step.id} className="relative flex gap-3">
            <div className="flex flex-col items-center">
              <div className={`h-3 w-3 shrink-0 rounded-full ${config.dotColor} mt-3 ring-2 ring-background`} />
              {!isLast && <div className="w-0.5 flex-1 bg-border" />}
            </div>

            <div className={`mb-2 flex-1 rounded-lg border-l-4 ${config.borderColor} ${config.bgColor} p-3`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <NodeIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate text-sm font-medium text-foreground">{step.label}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center rounded bg-background/80 px-1.5 py-0.5 text-overline font-medium uppercase text-muted-foreground">
                      {step.type}
                    </span>
                    {step.duration && (
                      <span className="text-overline text-muted-foreground">{step.duration}</span>
                    )}
                  </div>
                </div>
                <StatusIcon className={`h-4 w-4 shrink-0 ${config.iconColor} ${step.status === 'active' ? 'animate-spin' : ''}`} />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
