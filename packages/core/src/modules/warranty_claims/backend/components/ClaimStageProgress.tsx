"use client"

import { Check, ChevronRight } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const STAGE_INDEX: Record<string, number> = {
  draft: 0,
  submitted: 0,
  in_review: 1,
  info_requested: 1,
  approved: 2,
  rejected: 2,
  awaiting_return: 3,
  received: 3,
  inspecting: 3,
  resolved: 4,
  closed: 4,
  cancelled: 4,
}

type ClaimStageProgressProps = {
  status: string | null | undefined
}

export function ClaimStageProgress({ status }: ClaimStageProgressProps) {
  const t = useT()
  const currentIndex = STAGE_INDEX[status ?? 'draft'] ?? 0
  const stages = [
    t('warranty_claims.detail.stage.intake', 'Intake'),
    t('warranty_claims.detail.stage.review', 'Review'),
    t('warranty_claims.detail.stage.approved', 'Approved'),
    t('warranty_claims.detail.stage.goodsIn', 'Goods-in'),
    t('warranty_claims.detail.stage.resolved', 'Resolved'),
  ]

  return (
    <div className="border-t border-border bg-muted/30 px-8 py-3">
      <ol className="flex flex-wrap items-center gap-2">
        {stages.map((label, index) => {
          const completed = index < currentIndex
          const active = index === currentIndex
          return (
            <li key={label} className="flex min-w-0 items-center gap-2">
              {index > 0 ? <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" /> : null}
              <span
                className={cn(
                  'relative z-10 flex size-6 items-center justify-center rounded-full border text-xs font-semibold',
                  completed && 'border-status-success-icon bg-status-success-icon text-white',
                  active && 'border-accent-indigo bg-accent-indigo text-primary-foreground',
                  !completed && !active && 'border-border bg-background text-muted-foreground',
                )}
              >
                {completed ? <Check className="size-3.5" aria-hidden /> : index + 1}
              </span>
              <span className={cn('truncate text-sm', active ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
                {label}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
