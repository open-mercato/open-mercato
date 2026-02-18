"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { cn } from '@open-mercato/shared/lib/utils'
import type { MessagePriority } from '../lib/priorityUtils'
import {
  getPriorityBadgeVariant,
  getPriorityBadgeClassName,
  getPriorityLabelKey,
  getPriorityFallbackLabel,
} from '../lib/priorityUtils'

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

  return (
    <Badge
      variant={getPriorityBadgeVariant(priority)}
      className={cn(getPriorityBadgeClassName(priority), className)}
    >
      {priorityTitle}: {priorityLabel}
    </Badge>
  )
}

export default PriorityBadge