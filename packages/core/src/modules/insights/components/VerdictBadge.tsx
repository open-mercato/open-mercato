import * as React from 'react'
import { CircleCheck, CircleDashed, CircleSlash, Clock, TriangleAlert, type LucideIcon } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import type { ExplainVerdict } from '@open-mercato/shared/modules/insights/explain'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'

export const VERDICT_STATUS_MAP: StatusMap<ExplainVerdict> = {
  explained: 'success',
  partially_explained: 'warning',
  unexplained: 'warning',
  no_history: 'neutral',
  pending: 'info',
}

const VERDICT_ICONS: Record<ExplainVerdict, LucideIcon> = {
  explained: CircleCheck,
  partially_explained: CircleDashed,
  unexplained: TriangleAlert,
  no_history: CircleSlash,
  pending: Clock,
}

export type VerdictBadgeProps = {
  verdict: ExplainVerdict
  className?: string
}

export function VerdictBadge({ verdict, className }: VerdictBadgeProps) {
  const t = useT()
  const Icon = VERDICT_ICONS[verdict] ?? CircleDashed
  return (
    <StatusBadge variant={VERDICT_STATUS_MAP[verdict] ?? 'neutral'} className={cn('shrink-0', className)}>
      <Icon className="size-3" aria-hidden="true" />
      <span className="sr-only">{t('insights.why.verdict.label')}{' '}</span>
      <span data-verdict={verdict}>{t(`insights.explain.verdicts.${verdict}`)}</span>
    </StatusBadge>
  )
}

export default VerdictBadge
