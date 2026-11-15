"use client"

import * as React from 'react'
import { Progress } from '@open-mercato/ui/primitives/progress'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import type { ProjectBudgetBurn } from '../timesheets-projects/budgetBurn'

export type ProjectBudgetCellProps = {
  burn: ProjectBudgetBurn | null
  usageLabel: string | null
  noBudgetLabel: string
  ariaLabel: string
}

export function ProjectBudgetCell({ burn, usageLabel, noBudgetLabel, ariaLabel }: ProjectBudgetCellProps) {
  if (!burn) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">—</span>
        <StatusBadge variant="neutral">{noBudgetLabel}</StatusBadge>
      </div>
    )
  }

  return (
    <div className="min-w-36 space-y-1">
      <Progress value={burn.barPercent} size="sm" tone={burn.tone} aria-label={ariaLabel} />
      <span className="block text-xs text-muted-foreground">{usageLabel}</span>
    </div>
  )
}

export default ProjectBudgetCell
