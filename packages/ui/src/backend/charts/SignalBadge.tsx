"use client"

import * as React from 'react'
import { ArrowDownRight, ArrowUpRight, TrendingDown, TrendingUp, type LucideIcon } from 'lucide-react'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'

/** What the process-behaviour check found: a sustained shift or a single unusual period, and its direction. */
export type SignalKind = 'shift-up' | 'shift-down' | 'spike-up' | 'spike-down'

const SIGNAL_ICON: Record<SignalKind, LucideIcon> = {
  'shift-up': TrendingUp,
  'shift-down': TrendingDown,
  'spike-up': ArrowUpRight,
  'spike-down': ArrowDownRight,
}

export type SignalBadgeProps = {
  variant: StatusBadgeVariant
  label: string
  kind?: SignalKind | null
}

/** The one badge for a metric signal: status colour plus an icon for the kind of change, never a dot. */
export function SignalBadge({ variant, label, kind }: SignalBadgeProps) {
  const Icon = kind ? SIGNAL_ICON[kind] : null
  return (
    <StatusBadge variant={variant}>
      <span className="inline-flex items-center gap-1">
        {Icon ? <Icon className="size-3" aria-hidden="true" /> : null}
        {label}
      </span>
    </StatusBadge>
  )
}

export default SignalBadge
