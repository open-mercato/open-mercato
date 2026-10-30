'use client'

import type React from 'react'
import {
  Check,
  Play,
  Pause,
  Circle,
  CircleAlert,
  Hourglass,
  LoaderCircle,
  ShieldMinus,
  TriangleAlert,
  XCircle,
  Trash2,
} from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { STATUS_COLORS, WorkflowStatus } from '../lib/status-colors'
import type { StepReason } from '../lib/step-presentation'
import { formatElapsedSince } from '../lib/run-duration'
import { NODE_TYPE_ICONS, NODE_TYPE_ACCENTS, NODE_TYPE_COLORS, NODE_TYPE_LABELS, NodeType } from '../lib/node-type-icons'
import { NODE_MAX_WIDTH, NODE_MIN_WIDTH } from '../lib/node-geometry'
import {
  NODE_CONFIG_SUMMARY_SEPARATOR,
  resolveNodeConfigSummarySegment,
  type NodeConfigSummarySegment,
} from '../lib/node-config-summary'

/**
 * Rendered node sizing. Cards size to their content between these bounds and
 * the dagre layout reserves the same bounds; both read `lib/node-geometry`, so
 * there is one place to change them. Re-exported here because third-party code
 * has always imported them from this module.
 */
export { NODE_MIN_WIDTH, NODE_MAX_WIDTH }
/** @deprecated kept for back-compat; prefer NODE_MIN_WIDTH/NODE_MAX_WIDTH. */
export const NODE_WIDTH = NODE_MIN_WIDTH

/**
 * Dispatched when a node's inline trash button is clicked. The visual editor
 * listens for this on `window` and runs its confirm + edge-cleanup delete flow,
 * so the card stays decoupled from the page (no callback threaded through every
 * node component or the graph-utils data transform).
 */
export const WORKFLOW_NODE_DELETE_EVENT = 'workflow-node:delete'

/**
 * `data-slot` marking the element that carries a node's OWN label.
 *
 * Every card also renders an unconditional `sr-only` status name (spec §4.6:
 * status is never colour-only), which in the editor is always "Not started" —
 * so a text match for a step called "Start" over the whole card matches every
 * node on the canvas. Addressing the title element makes "which node is called
 * X" answerable without depending on the status copy or the locale.
 */
export const WORKFLOW_NODE_TITLE_SLOT = 'workflow-node-title'

/**
 * English fallbacks for the per-status label (spec section 4.6: status is never
 * colour-only, so every state has to have a NAME the card can announce).
 */
const STATUS_LABEL_FALLBACKS: Record<WorkflowStatus, string> = {
  completed: 'Completed',
  in_progress: 'In progress',
  pending: 'Pending',
  failed: 'Failed',
  paused: 'Paused',
  not_started: 'Not started',
  error: 'Has errors',
  working: 'Working',
  waiting: 'Waiting',
  needs_attention: 'Needs attention',
}

/**
 * Per-status glyph. Every RUN state gets its OWN shape, because the colour is
 * never allowed to be the only signal (spec §4.6) — and because `working` and
 * `waiting` are the pair this whole model exists to tell apart, they get the two
 * most different marks on the card: a spinner ring and an hourglass.
 */
export const STATUS_ICONS: Record<WorkflowStatus, typeof Check> = {
  completed: Check,
  in_progress: Play,
  pending: Pause,
  failed: XCircle,
  paused: Pause,
  not_started: Circle,
  error: CircleAlert,
  working: LoaderCircle,
  waiting: Hourglass,
  needs_attention: TriangleAlert,
}

/**
 * Motion is an ENHANCEMENT, never the distinction. `motion-reduce:animate-none`
 * honours `prefers-reduced-motion`, and with animation off a working step is
 * still a blue card carrying a spinner ring, an announced name and its own
 * reason line — none of which depend on the spin.
 */
const STATUS_MOTION: Partial<Record<WorkflowStatus, string>> = {
  working: 'animate-spin motion-reduce:animate-none',
}

export function requestWorkflowNodeDeletion(nodeId: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(WORKFLOW_NODE_DELETE_EVENT, { detail: { nodeId } }))
}

export type WorkflowNodeCardVariant = 'card' | 'pill'

interface WorkflowNodeCardProps {
  title: string
  description?: string
  status?: WorkflowStatus
  nodeType: NodeType
  selected?: boolean
  hasError?: boolean
  errorCount?: number
  /**
   * Spec section 4.3: the badge cluster's compensation marker. Set by the canvas
   * while the compensation toggle is on, for a step whose outgoing routes carry
   * activities that declare compensation.
   */
  hasCompensation?: boolean
  /** Node id — required to render the inline delete affordance. */
  nodeId?: string
  /** When true (and `nodeId` is set), show the hover/selected trash button. */
  editable?: boolean
  /**
   * How the node presents itself. `'card'` is a step: a capped, titled card
   * with a description. `'pill'` is a terminal (START / END): an auto-width
   * lozenge carrying only its icon and name, so the two ends of a flow stop
   * competing for attention with the steps between them.
   */
  variant?: WorkflowNodeCardVariant
  /**
   * Outcome-row footer (fidelity gap #4). Rendered INSIDE the card, below a
   * hairline rule, so the rows read as part of the node rather than a second
   * floating object — which is what lets their dots double as the node's
   * per-outcome connection handles. Terminals (`variant: 'pill'`) never take
   * one: a pill has no body to hang rows off.
   */
  footer?: React.ReactNode
  /**
   * One-line CONFIG summary (fidelity gap #6): `customers.deals.update ·
   * retries 3×`. Preferred over `description`, which then becomes the card's
   * tooltip — two clamped lines of prose truncate mid-word and cannot tell you
   * what the step actually does. An empty list falls back to `description`, so
   * an unconfigured node never reads emptier than before.
   */
  summary?: NodeConfigSummarySegment[]
  /**
   * The one-line "what is this doing / waiting for" (spec Part 2), resolved by
   * `lib/step-presentation.ts`. A translation descriptor rather than a string,
   * because the resolver is pure and never sees a locale.
   */
  runReason?: StepReason | null
  /**
   * When the current attempt started, so a working step can also say "running
   * for 4m" — the second question an operator asks, and free because
   * `StepInstance.startedAt` already carries it.
   */
  runStartedAt?: Date | null
}

export function WorkflowNodeCard({
  title,
  description,
  status = 'not_started',
  nodeType,
  selected = false,
  hasError = false,
  errorCount,
  hasCompensation = false,
  nodeId,
  editable = false,
  variant = 'card',
  footer,
  summary,
  runReason = null,
  runStartedAt = null,
}: WorkflowNodeCardProps) {
  const t = useT()
  const resolvedSummary = summary?.map((segment) => ({
    segment,
    text: resolveNodeConfigSummarySegment(segment, t),
  }))
  // In edit mode (not_started), use white background
  const isEditMode = status === 'not_started'
  const colors = STATUS_COLORS[status]

  const StatusIcon = STATUS_ICONS[status]

  const NodeTypeIcon = NODE_TYPE_ICONS[nodeType]
  const nodeTypeIconColor = NODE_TYPE_COLORS[nodeType]
  // Type gets its own channel (the painted cap) so the card's border and
  // background are left to speak only for run status. A selected or failing
  // card wants its whole outline to read as one state, so the accent yields.
  const accentClass = selected || hasError ? '' : NODE_TYPE_ACCENTS[nodeType]
  const nodeTypeLabel = NODE_TYPE_LABELS[nodeType]?.title ?? nodeType
  const showDelete = editable && !!nodeId

  const backgroundClass = isEditMode ? 'bg-card' : colors.bg
  const borderClass = selected
    ? 'border-primary'
    : hasError
      ? 'border-status-error-border'
      : isEditMode
        ? 'border-border'
        : colors.border
  const compensationBadgeLabel = t(
    'workflows.compensation.nodeBadge',
    'Leaving this step schedules compensation',
  )
  const errorBadgeLabel = t(
    'workflows.visualEditor.problems.nodeErrorBadge',
    '{count} validation error(s)',
    { count: typeof errorCount === 'number' && errorCount > 0 ? errorCount : 1 },
  )

  // Spec section 4.6: status is never colour-only and every card announces what
  // it is. The status icon shape already differs per state; this names it, so a
  // screen reader hears "User task · Approve order · Failed" rather than a
  // shapeless card whose only other cue is a red border.
  const statusLabel = t(`workflows.nodeStatus.${status}`, STATUS_LABEL_FALLBACKS[status])
  const cardLabel = t(
    'workflows.visualEditor.nodeCardLabel',
    '{type}: {title} — {status}',
    { type: nodeTypeLabel, title, status: statusLabel },
  )

  // Gap 8: the status glyph is a RUN affordance. In the editor every node is
  // `not_started`, so rendering it there put a meaningless hollow ring on every
  // single card. The `sr-only` name stays unconditional — it is what keeps
  // status from being colour-only (spec section 4.6).
  const statusGlyph = isEditMode ? null : (
    <StatusIcon
      className={`h-4 w-4 shrink-0 ${colors.icon} ${STATUS_MOTION[status] ?? ''}`.trimEnd()}
      aria-hidden="true"
    />
  )

  // The reason line (spec Part 2). It is the answer to "is anything happening
  // right now, or is this stuck?", so it sits directly under the title and it
  // is TEXT — a card whose animation is disabled still says what it is doing.
  const reasonText = runReason ? t(runReason.key, runReason.fallback, runReason.params) : null
  const elapsed = runStartedAt ? formatElapsedSince(runStartedAt, null) : null
  const reasonLine = reasonText ? (
    <p className={`mt-1 truncate text-xs ${colors.text}`} title={reasonText}>
      {reasonText}
      {elapsed ? (
        <span className="text-muted-foreground">
          {` · ${t('workflows.runState.elapsed', 'running for {duration}', { duration: elapsed })}`}
        </span>
      ) : null}
    </p>
  ) : null

  const badges = (
    <>
      {hasError && (
        <span
          role="status"
          aria-label={errorBadgeLabel}
          title={errorBadgeLabel}
          className="absolute -top-2 -right-2 z-10 inline-flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-background bg-status-error-icon px-1 text-xs font-bold text-primary-foreground"
        >
          {typeof errorCount === 'number' && errorCount > 0 ? (
            errorCount
          ) : (
            <CircleAlert className="h-3 w-3" aria-hidden="true" />
          )}
        </span>
      )}

      {/* Compensation marker (spec section 4.3). Paired with its own icon shape
          and an announced name, never colour alone (spec section 4.6). */}
      {hasCompensation && (
        <span
          role="img"
          data-testid="workflow-node-compensation-badge"
          aria-label={compensationBadgeLabel}
          title={compensationBadgeLabel}
          className="absolute -bottom-2 -right-2 z-10 inline-flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-background bg-status-warning-bg px-1 text-status-warning-text"
        >
          <ShieldMinus className="h-3 w-3" aria-hidden="true" />
        </span>
      )}
    </>
  )

  const deleteButton = showDelete ? (
    <button
      type="button"
      aria-label={t('workflows.visualEditor.deleteStep', 'Delete step')}
      className="nodrag nopan -mr-1 -mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-status-error-icon focus-visible:opacity-100 group-hover:opacity-100"
      onClick={(event) => {
        event.stopPropagation()
        event.preventDefault()
        requestWorkflowNodeDeletion(nodeId!)
      }}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  ) : null

  const elevationClass = selected ? 'ring-2 ring-primary' : 'shadow-sm hover:shadow-md'

  if (variant === 'pill') {
    return (
      <div
        role="group"
        aria-label={cardLabel}
        data-node-status={status}
        data-node-variant="pill"
        title={description}
        style={{ maxWidth: NODE_MAX_WIDTH }}
        className={`
          group relative inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5
          ${backgroundClass} ${borderClass}
          transition-all duration-200 ${elevationClass}
        `}
      >
        {badges}
        <span className="sr-only">{statusLabel}</span>
        <NodeTypeIcon className={`h-3.5 w-3.5 shrink-0 ${nodeTypeIconColor}`} aria-hidden="true" />
        {statusGlyph}
        <span
          data-slot={WORKFLOW_NODE_TITLE_SLOT}
          className={`truncate text-sm font-semibold leading-snug ${colors.text}`}
        >
          {title}
        </span>
        {deleteButton}
      </div>
    )
  }

  return (
    <div
      role="group"
      aria-label={cardLabel}
      data-node-status={status}
      data-node-variant="card"
      style={{ minWidth: NODE_MIN_WIDTH, maxWidth: NODE_MAX_WIDTH }}
      className={`
        group w-fit rounded-lg border border-t-4 ${accentClass}
        ${backgroundClass} ${borderClass}
        transition-all duration-200 relative ${elevationClass}
      `}
    >
      {badges}

      {/* Type label + (editable) inline delete */}
      <div className="flex items-center justify-between gap-2 px-2.5 pt-2">
        <div className="flex min-w-0 items-center gap-1">
          <NodeTypeIcon className={`h-3 w-3 shrink-0 ${nodeTypeIconColor}`} aria-hidden="true" />
          <span className="truncate text-overline font-semibold uppercase tracking-wide text-muted-foreground">
            {nodeTypeLabel}
          </span>
        </div>
        {deleteButton}
      </div>

      <div className="flex items-start gap-2 px-2.5 pb-2.5 pt-1">
        <span className="sr-only">{statusLabel}</span>
        {statusGlyph ? <div className="mt-0.5">{statusGlyph}</div> : null}
        <div className="min-w-0 flex-1">
          <h3
            data-slot={WORKFLOW_NODE_TITLE_SLOT}
            className={`break-words text-sm font-semibold leading-snug ${colors.text}`}
          >
            {title}
          </h3>
          {resolvedSummary && resolvedSummary.length > 0 ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground" title={description}>
              {resolvedSummary.map(({ segment, text }, index) => (
                <span key={`${segment.translationKey ?? segment.text}-${index}`}>
                  {index > 0 && NODE_CONFIG_SUMMARY_SEPARATOR}
                  <span className={segment.mono ? 'font-mono' : undefined}>{text}</span>
                </span>
              ))}
            </p>
          ) : description ? (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {description}
            </p>
          ) : null}
          {reasonLine}
        </div>
      </div>

      {footer}
    </div>
  )
}
