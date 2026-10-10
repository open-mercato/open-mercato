"use client"

import * as React from 'react'
import { Bot, History, Minus, Shuffle, UserRound, type LucideIcon } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import type { XrayCauseClass } from '../../lib/client/xray/graph'

export const XRAY_CAUSE_ICONS: Record<XrayCauseClass, LucideIcon> = {
  human: UserRound,
  automated: Bot,
  legacy: History,
  mixed: Shuffle,
  none: Minus,
}

/** Series colors of the cause classes (chart palette: the map is a data visualization). */
export const XRAY_CAUSE_TEXT_CLASSES: Record<XrayCauseClass, string> = {
  human: 'text-chart-blue',
  automated: 'text-chart-violet',
  legacy: 'text-muted-foreground',
  mixed: 'text-chart-teal',
  none: 'text-muted-foreground',
}

export const XRAY_CAUSE_BORDER_CLASSES: Record<XrayCauseClass, string> = {
  human: 'border-l-chart-blue',
  automated: 'border-l-chart-violet',
  legacy: 'border-l-muted-foreground',
  mixed: 'border-l-chart-teal',
  none: 'border-l-border',
}

export const XRAY_CAUSE_STROKES: Record<XrayCauseClass, string> = {
  human: 'var(--chart-blue)',
  automated: 'var(--chart-violet)',
  legacy: 'var(--muted-foreground)',
  mixed: 'var(--chart-teal)',
  none: 'var(--border)',
}

export function XrayCauseBadge({ causeClass, className }: { causeClass: XrayCauseClass; className?: string }) {
  const t = useT()
  const Icon = XRAY_CAUSE_ICONS[causeClass]
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs', className)} data-cause-class={causeClass}>
      <Icon className={cn('size-3 shrink-0', XRAY_CAUSE_TEXT_CLASSES[causeClass])} aria-hidden="true" />
      <span className="text-muted-foreground">{t(`insights.xray.ui.cause.${causeClass}`)}</span>
    </span>
  )
}

const LEGEND_CLASSES: XrayCauseClass[] = ['human', 'automated', 'legacy', 'mixed']

export function XrayCauseLegend({ children }: { children?: React.ReactNode }) {
  const t = useT()
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1" aria-label={t('insights.xray.ui.cause.legend')} role="group">
      {LEGEND_CLASSES.map((causeClass) => (
        <XrayCauseBadge key={causeClass} causeClass={causeClass} />
      ))}
      {children}
    </div>
  )
}
