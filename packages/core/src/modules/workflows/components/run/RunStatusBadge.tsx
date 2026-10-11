'use client'

import * as React from 'react'
import { Check, Circle, CircleAlert, Pause, Play, SkipForward, Undo2, XCircle } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { STATUS_COLORS, type WorkflowStatus, type StepRunStatus } from '../../lib/status-colors'

type BadgeDescriptor = {
  tone: WorkflowStatus
  Icon: React.ComponentType<{ className?: string }>
  fallbackLabel: string
}

/**
 * `toWorkflowStatus` is the CANVAS mapping and deliberately collapses anything
 * it does not know to `not_started`, which would paint a skipped step and a
 * never-run step identically. A badge carries a label, so it can afford — and
 * needs — the finer vocabulary.
 */
const STEP_STATUS_BADGES: Record<StepRunStatus, BadgeDescriptor> = {
  completed: { tone: 'completed', Icon: Check, fallbackLabel: 'Completed' },
  active: { tone: 'in_progress', Icon: Play, fallbackLabel: 'Running' },
  failed: { tone: 'failed', Icon: XCircle, fallbackLabel: 'Failed' },
  skipped: { tone: 'pending', Icon: SkipForward, fallbackLabel: 'Skipped' },
  paused: { tone: 'paused', Icon: Pause, fallbackLabel: 'Waiting' },
  pending: { tone: 'not_started', Icon: Circle, fallbackLabel: 'Not started' },
}

const INSTANCE_STATUS_BADGES: Record<string, BadgeDescriptor> = {
  RUNNING: { tone: 'in_progress', Icon: Play, fallbackLabel: 'Running' },
  PAUSED: { tone: 'paused', Icon: Pause, fallbackLabel: 'Paused' },
  WAITING_FOR_ACTIVITIES: { tone: 'paused', Icon: Pause, fallbackLabel: 'Waiting for activities' },
  FORKED: { tone: 'in_progress', Icon: Play, fallbackLabel: 'Forked' },
  COMPLETED: { tone: 'completed', Icon: Check, fallbackLabel: 'Completed' },
  FAILED: { tone: 'failed', Icon: XCircle, fallbackLabel: 'Failed' },
  CANCELLED: { tone: 'not_started', Icon: SkipForward, fallbackLabel: 'Cancelled' },
  COMPENSATING: { tone: 'pending', Icon: CircleAlert, fallbackLabel: 'Compensating' },
  COMPENSATED: { tone: 'pending', Icon: Undo2, fallbackLabel: 'Compensated' },
}

const UNKNOWN_BADGE: BadgeDescriptor = { tone: 'not_started', Icon: Circle, fallbackLabel: 'Unknown' }

/** The i18n key + English fallback for one step status, shared with the Gantt. */
export function stepStatusLabelKey(status: StepRunStatus): { key: string; fallback: string } {
  const descriptor = STEP_STATUS_BADGES[status] ?? UNKNOWN_BADGE
  return { key: `workflows.instances.run.stepStatus.${status}`, fallback: descriptor.fallbackLabel }
}

/**
 * Class-only form, for the mobile overview which takes a class callback rather
 * than a component. Reads the same descriptor table, so the two surfaces can
 * never drift apart.
 */
export function instanceStatusBadgeClass(status: string): string {
  const colors = STATUS_COLORS[(INSTANCE_STATUS_BADGES[status] ?? UNKNOWN_BADGE).tone]
  return `${colors.bg} ${colors.text}`
}

function Badge({
  descriptor,
  label,
  className,
}: {
  descriptor: BadgeDescriptor
  label: string
  className: string
}) {
  const colors = STATUS_COLORS[descriptor.tone]
  const { Icon } = descriptor
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium ${colors.bg} ${colors.text} ${className}`}
    >
      <Icon className={`h-3.5 w-3.5 shrink-0 ${colors.icon}`} aria-hidden="true" />
      {label}
    </span>
  )
}

/**
 * Spec §4.6 acceptance criterion — status is never colour-only. Every badge
 * pairs its DS status token with its own glyph shape AND a text label, so the
 * same red is never the sole difference between two states.
 */
export function RunStatusBadge({ status, className = '' }: { status: StepRunStatus; className?: string }) {
  const t = useT()
  const descriptor = STEP_STATUS_BADGES[status] ?? UNKNOWN_BADGE
  return (
    <Badge
      descriptor={descriptor}
      label={t(`workflows.instances.run.stepStatus.${status}`, descriptor.fallbackLabel)}
      className={className}
    />
  )
}

/**
 * Instance-level counterpart. `WorkflowInstance.status` is a wider vocabulary
 * than the step one (it carries the compensation states), so it gets its own
 * map rather than being squeezed through the step vocabulary.
 */
export function InstanceStatusBadge({ status, className = '' }: { status: string; className?: string }) {
  const t = useT()
  const descriptor = INSTANCE_STATUS_BADGES[status] ?? UNKNOWN_BADGE
  return (
    <Badge
      descriptor={descriptor}
      label={t(`workflows.instances.status.${status}`, descriptor.fallbackLabel)}
      className={className}
    />
  )
}
