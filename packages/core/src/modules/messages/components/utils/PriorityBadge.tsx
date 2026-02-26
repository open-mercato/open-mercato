"use client"

import * as React from 'react'
import { ArrowDown, ArrowUp, Circle, TriangleAlert } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { SimpleTooltip, TooltipProvider } from '@open-mercato/ui/primitives/tooltip'
import type { MessagePriority } from '../../lib/priorityUtils'
import {
  getPriorityBadgeClassName,
  getPriorityLabelKey,
  getPriorityFallbackLabel,
} from '../../lib/priorityUtils'

export type PriorityBadgeProps = {
  priority: MessagePriority
  className?: string
}

export function PriorityBadge({ priority, className }: PriorityBadgeProps) {
  const t = useT()
  const priorityTitle = t('messages.priority', 'Priority')

  const priorityLabel = React.useMemo(() => {
    return t(getPriorityLabelKey(priority), getPriorityFallbackLabel(priority))
  }, [priority, t])

  const tooltipText = `${priorityTitle}: ${priorityLabel}`

  const Icon = React.useMemo(() => {
    switch (priority) {
      case 'low':
        return ArrowDown
      case 'high':
        return ArrowUp
      case 'urgent':
        return TriangleAlert
      case 'normal':
      default:
        return Circle
    }
  }, [priority])

  return (
    <TooltipProvider delayDuration={250}>
      <SimpleTooltip content={tooltipText}>
        <span
          className={cn(
            'inline-flex h-6 w-6 items-center justify-center rounded-md border',
            getPriorityBadgeClassName(priority),
            className,
          )}
          aria-label={tooltipText}
          title={tooltipText}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      </SimpleTooltip>
    </TooltipProvider>
  )
}

export default PriorityBadge
