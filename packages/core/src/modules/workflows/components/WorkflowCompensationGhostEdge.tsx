'use client'

import { BaseEdge, EdgeLabelRenderer, EdgeProps, getBezierPath } from '@xyflow/react'
import { ShieldMinus } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { CompensationGhostEdgeData } from '../lib/compensation-ghosts'

/**
 * A compensation ghost (spec section 4.4: "dashed reverse, behind a toggle").
 *
 * It renders the undo path a failure would walk: the reverse of a route whose
 * activities declare `compensation`. It is display-only — non-interactive, never
 * part of the saved definition — and it is deliberately unmistakable next to a
 * real route: its own dash-dot pattern, the warning token, AND a permanent
 * icon + label chip, because status is never colour-only (spec section 4.6).
 */
export function WorkflowCompensationGhostEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps) {
  const t = useT()
  const ghostData = data as CompensationGhostEdgeData | undefined
  const compensated = (ghostData?.compensatedActivityNames ?? []).filter((name) => name.length > 0)
  const title = t('workflows.compensation.ghostLabel', 'Compensation')
  const ariaLabel = compensated.length > 0
    ? t('workflows.compensation.ghostAriaLabel', 'Compensation path for {activities}', {
        activities: compensated.join(', '),
      })
    : title

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        role="img"
        aria-label={ariaLabel}
        style={{
          stroke: 'var(--status-warning-icon)',
          strokeWidth: 2,
          strokeDasharray: '10,4,2,4',
          opacity: 0.85,
        }}
      />
      <EdgeLabelRenderer>
        <div
          data-testid="workflow-compensation-ghost-label"
          title={ariaLabel}
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'none',
            zIndex: 1500,
          }}
          className="nodrag nopan inline-flex items-center gap-1 rounded-full border border-status-warning-border bg-status-warning-bg px-2 py-0.5 text-overline font-semibold uppercase tracking-wide text-status-warning-text"
        >
          <ShieldMinus className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span>{title}</span>
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
