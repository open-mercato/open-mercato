"use client"

import * as React from 'react'
import { Ban, CheckCircle2, Clock, Loader2, XCircle, type LucideIcon } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import type { SimulationRunStatus } from '../../lib/client/simulation/types'

type StatusPresentation = { variant: StatusBadgeVariant; Icon: LucideIcon; spin: boolean }

const STATUS_PRESENTATION: Record<SimulationRunStatus, StatusPresentation> = {
  queued: { variant: 'neutral', Icon: Clock, spin: false },
  running: { variant: 'info', Icon: Loader2, spin: true },
  completed: { variant: 'success', Icon: CheckCircle2, spin: false },
  failed: { variant: 'error', Icon: XCircle, spin: false },
  cancelled: { variant: 'neutral', Icon: Ban, spin: false },
}

function presentationOf(status: SimulationRunStatus): StatusPresentation {
  return STATUS_PRESENTATION[status] ?? STATUS_PRESENTATION.queued
}

export function simulationStatusVariant(status: SimulationRunStatus): StatusBadgeVariant {
  return presentationOf(status).variant
}

/** The icon + text of a run status (the meaning never depends on color alone). */
export function SimulationStatusContent({ status }: { status: SimulationRunStatus }) {
  const t = useT()
  const { Icon, spin } = presentationOf(status)
  return (
    <span className="inline-flex items-center gap-1" data-testid="simulation-status" data-status={status}>
      <Icon className={spin ? 'size-3 animate-spin motion-reduce:animate-none' : 'size-3'} aria-hidden="true" />
      {t(`insights.simulation.status.${status}`)}
    </span>
  )
}

export function SimulationStatusBadge({ status }: { status: SimulationRunStatus }) {
  return (
    <StatusBadge variant={simulationStatusVariant(status)}>
      <SimulationStatusContent status={status} />
    </StatusBadge>
  )
}
