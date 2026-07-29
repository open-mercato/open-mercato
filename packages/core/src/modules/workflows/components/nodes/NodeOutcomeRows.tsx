'use client'

import { Handle, Position } from '@xyflow/react'
import { Check, CircleAlert, CornerDownLeft, Info, ShieldMinus, Slash, Dot } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import type { NodeOutcomeRow, NodeOutcomeRowGlyph, NodeOutcomeRowTone } from '../../lib/node-outcome-rows'
import { NODE_HANDLE_CLASS, NODE_HANDLE_EDGE_OFFSET } from '../../lib/node-geometry'

/**
 * The node's outcome-row footer (fidelity gap #4, spec §7.2).
 *
 * A hairline rule, right-aligned rows, and a dot overhanging the right edge that
 * IS the connection handle — so wiring a disposition is drawing a line from the
 * row that names it.
 *
 * Accessibility (spec §4.6 acceptance criterion): the LABEL carries the meaning,
 * never the dot colour. Two of these rows are red, which at 10px and at canvas
 * zoom is not a distinction anyone can read — so each row also carries its own
 * glyph, and each handle is named for assistive users. The labels are therefore
 * not decorative and must never be dropped for a denser rendering.
 */

const TONE_DOT_CLASSES: Record<NodeOutcomeRowTone, string> = {
  success: '!bg-status-success-icon',
  warning: '!bg-status-warning-icon',
  error: '!bg-status-error-icon',
  info: '!bg-status-info-icon',
  neutral: '!bg-muted-foreground',
}

const TONE_TEXT_CLASSES: Record<NodeOutcomeRowTone, string> = {
  success: 'text-status-success-icon',
  warning: 'text-status-warning-icon',
  error: 'text-status-error-icon',
  info: 'text-status-info-icon',
  neutral: 'text-muted-foreground',
}

const GLYPH_COMPONENTS: Record<NodeOutcomeRowGlyph, typeof Check> = {
  check: Check,
  info: Info,
  slash: Slash,
  shield: ShieldMinus,
  alert: CircleAlert,
  dot: Dot,
  corner: CornerDownLeft,
}

export interface NodeOutcomeRowsProps {
  rows: NodeOutcomeRow[]
  /**
   * The step's ordinary output, rendered as the LAST row so every outgoing
   * connection leaves the card from a footer row — one x-position, one dot
   * size, one vertical rhythm. Passing it is what tells the node not to render
   * its own floating source handle; omitting it keeps the node's handle where
   * it always was.
   */
  defaultRow?: NodeOutcomeRow
  isConnectable?: boolean
  /**
   * Announced when an outcome has no route: §7.2 requires the node face to
   * state that unwired outcomes inherit the step's error directive.
   */
  inheritanceNote?: string
  revealLabel?: string
  onReveal?: () => void
  testId?: string
}

export function NodeOutcomeRows({
  rows,
  defaultRow,
  isConnectable,
  inheritanceNote,
  revealLabel,
  onReveal,
  testId,
}: NodeOutcomeRowsProps) {
  const t = useT()
  if (rows.length === 0 && !defaultRow) return null

  const allRows = defaultRow ? [...rows, defaultRow] : rows

  return (
    <div
      className="border-t border-border px-2 py-1"
      data-testid={testId ?? 'workflow-node-outcome-rows'}
    >
      <div className="grid gap-0.5">
        {allRows.map((row) => {
          const label = row.labelKey ? t(row.labelKey, row.labelFallback) : row.labelFallback
          const Glyph = GLYPH_COMPONENTS[row.glyph]
          return (
            <div
              key={row.handleId}
              className="relative flex min-h-4 items-center justify-end gap-1 pr-2"
              {...(row === defaultRow
                ? { 'data-default-route-handle': row.handleId }
                : { 'data-outcome-handle': row.handleId })}
            >
              <Glyph className={`h-3 w-3 shrink-0 ${TONE_TEXT_CLASSES[row.tone]}`} aria-hidden="true" />
              <span className="truncate text-overline text-muted-foreground">{label}</span>
              <Handle
                type="source"
                position={Position.Right}
                id={row.handleId}
                isConnectable={isConnectable}
                title={label}
                aria-label={label}
                style={{ right: NODE_HANDLE_EDGE_OFFSET, top: '50%' }}
                className={`${NODE_HANDLE_CLASS} ${TONE_DOT_CLASSES[row.tone]}`}
              />
            </div>
          )
        })}
      </div>
      {revealLabel && onReveal && (
        <div className="mt-1 flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="2xs"
            className="nodrag nopan"
            onClick={(event) => {
              // Reveal the remaining outcome rows in place. Without stopping
              // propagation the click also bubbles to React Flow's onNodeClick,
              // which opens the node edit dialog — the wrong surface for a
              // canvas-local disclosure.
              event.stopPropagation()
              onReveal()
            }}
          >
            {revealLabel}
          </Button>
        </div>
      )}
      {inheritanceNote && (
        <p className="mt-0.5 text-right text-overline text-muted-foreground">{inheritanceNote}</p>
      )}
    </div>
  )
}
