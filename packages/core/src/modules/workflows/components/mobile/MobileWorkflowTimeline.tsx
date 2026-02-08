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
    borderColor: 'border-l-emerald-500',
    bgColor: 'bg-emerald-50 dark:bg-emerald-950/30',
    icon: CheckCircle2,
    iconColor: 'text-emerald-600',
    dotColor: 'bg-emerald-500',
  },
  active: {
    borderColor: 'border-l-blue-500',
    bgColor: 'bg-blue-50 dark:bg-blue-950/30',
    icon: Loader2,
    iconColor: 'text-blue-600',
    dotColor: 'bg-blue-500',
  },
  pending: {
    borderColor: 'border-l-gray-300 dark:border-l-gray-600',
    bgColor: 'bg-gray-50 dark:bg-gray-900/30',
    icon: Circle,
    iconColor: 'text-gray-400',
    dotColor: 'bg-gray-300 dark:bg-gray-600',
  },
  failed: {
    borderColor: 'border-l-red-500',
    bgColor: 'bg-red-50 dark:bg-red-950/30',
    icon: AlertCircle,
    iconColor: 'text-red-600',
    dotColor: 'bg-red-500',
  },
  skipped: {
    borderColor: 'border-l-yellow-400',
    bgColor: 'bg-yellow-50 dark:bg-yellow-950/30',
    icon: Circle,
    iconColor: 'text-yellow-500',
    dotColor: 'bg-yellow-400',
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
              {!isLast && <div className="w-0.5 flex-1 bg-gray-200 dark:bg-gray-700" />}
            </div>

            <div className={`mb-2 flex-1 rounded-lg border-l-4 ${config.borderColor} ${config.bgColor} p-3`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <NodeIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate text-sm font-medium text-foreground">{step.label}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center rounded bg-background/60 px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                      {step.type}
                    </span>
                    {step.duration && (
                      <span className="text-[10px] text-muted-foreground">{step.duration}</span>
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
