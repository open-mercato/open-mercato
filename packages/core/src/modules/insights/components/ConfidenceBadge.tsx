import * as React from 'react'
import { CircleDashed, CircleHelp, ShieldCheck, type LucideIcon } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import type { ExplainConfidence } from '@open-mercato/shared/modules/insights/explain'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'

export const CONFIDENCE_STATUS_MAP: StatusMap<ExplainConfidence> = {
  proven: 'success',
  inferred: 'warning',
  unknown: 'neutral',
}

const CONFIDENCE_ICONS: Record<ExplainConfidence, LucideIcon> = {
  proven: ShieldCheck,
  inferred: CircleHelp,
  unknown: CircleDashed,
}

export type ConfidenceBadgeProps = {
  confidence: ExplainConfidence
  className?: string
}

export function ConfidenceBadge({ confidence, className }: ConfidenceBadgeProps) {
  const t = useT()
  const Icon = CONFIDENCE_ICONS[confidence] ?? CircleDashed
  return (
    <StatusBadge variant={CONFIDENCE_STATUS_MAP[confidence] ?? 'neutral'} className={cn('shrink-0', className)}>
      <Icon className="size-3" aria-hidden="true" />
      <span className="sr-only">{t('insights.why.confidence.label')}{' '}</span>
      <span data-confidence={confidence}>{t(`insights.explain.confidence.${confidence}`)}</span>
    </StatusBadge>
  )
}

export default ConfidenceBadge
