"use client"

/**
 * Work-inbox status / priority / overdue chip.
 *
 * One component for every work surface (the inbox table, the task detail, the
 * record-page widget) so the "status is never colour-only" rule is satisfied in
 * one place: the design-system token comes from `lib/work-inbox/presentation.ts`
 * and is always paired with the descriptor's own icon and a translated label.
 */

import * as React from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Circle,
  Clock,
  Flame,
  Loader,
  Minus,
  XCircle,
} from 'lucide-react'
import type { WorkInboxIconName, WorkInboxStatusDescriptor } from '../../lib/work-inbox/presentation'

export const WORK_INBOX_ICONS: Record<
  WorkInboxIconName,
  React.ComponentType<{ className?: string }>
> = {
  Clock,
  Loader,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Flame,
  ArrowUp,
  Minus,
  ArrowDown,
  Circle,
}

export type StatusChipProps = {
  descriptor: WorkInboxStatusDescriptor
  label: string
  className?: string
}

export function StatusChip({ descriptor, label, className }: StatusChipProps) {
  const Icon = WORK_INBOX_ICONS[descriptor.iconName]
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium ${descriptor.badge}${className ? ` ${className}` : ''}`}
    >
      <Icon className={`h-3 w-3 ${descriptor.icon}`} aria-hidden="true" />
      {label}
    </span>
  )
}

export default StatusChip
