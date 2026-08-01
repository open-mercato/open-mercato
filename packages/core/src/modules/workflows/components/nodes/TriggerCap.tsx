'use client'

import { ChevronRight, MousePointerClick, PowerOff, Zap } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { TriggerNodeModel } from '../../lib/trigger-node'

/**
 * The trigger "cap" (fidelity gap #5, Direction A) — a compact, clickable
 * summary of what starts a workflow, folded onto the START node.
 *
 * Two layouts:
 * - `variant="header"` (default in `StartNode`): a full-width header row that
 *   sits ATOP the Start card, forming one unified card (rounded top, hairline
 *   rule below). This is the shipped look.
 * - `variant="pill"`: a standalone rounded pill (used by tests / any host that
 *   wants a detached chip).
 *
 * Everything it states is true of the running system (derived in
 * `lib/trigger-node.ts`): the manual/API path is always available because
 * `startWorkflow` needs no trigger, and a disabled definition says nothing
 * starts it at all. Accessibility (spec §4.6): it IS a `<button>`, carries a
 * named `aria-label`, and every state pairs its token colour with a glyph and a
 * label — never colour alone.
 */
export function TriggerCap({
  model,
  onOpen,
  variant = 'pill',
}: {
  model: TriggerNodeModel
  onOpen?: () => void
  variant?: 'pill' | 'header'
}) {
  const t = useT()
  const { triggerCount, enabledCount, definitionEnabled } = model

  const openLabel = t('workflows.triggerNode.open', 'Edit triggers')
  const manualLabel = t('workflows.triggerNode.manual', 'manual / API start')
  const countLabel =
    triggerCount === 1
      ? t('workflows.triggerNode.capCountOne', '{count} trigger', { count: triggerCount })
      : t('workflows.triggerNode.capCount', '{count} triggers', { count: triggerCount })
  const definitionDisabledLabel = t(
    'workflows.triggerNode.definitionDisabled',
    'workflow disabled — nothing starts it',
  )
  const summary = definitionEnabled
    ? t(
        'workflows.triggerNode.summary',
        '{enabled} of {total} event trigger(s) active, plus manual and API start',
        { enabled: enabledCount, total: triggerCount },
      )
    : definitionDisabledLabel

  const isHeader = variant === 'header'
  const shapeClass = isHeader
    ? 'flex w-full rounded-t-lg border-b px-3 py-1.5'
    : 'inline-flex w-fit max-w-full rounded-md border px-2 py-0.5 shadow-sm'
  const baseClass = `nodrag nopan items-center gap-1 text-overline font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${shapeClass}`

  const commonProps = {
    type: 'button' as const,
    'data-testid': 'workflow-trigger-cap',
    'aria-label': `${summary}. ${openLabel}`,
    title: openLabel,
    onClick: (event: React.MouseEvent) => {
      event.stopPropagation()
      onOpen?.()
    },
  }

  if (!definitionEnabled) {
    return (
      <button
        {...commonProps}
        data-trigger-definition-disabled="true"
        className={`${baseClass} border-status-warning-border bg-status-warning-bg text-status-warning-text hover:brightness-95`}
      >
        <PowerOff className="h-3 w-3 shrink-0 text-status-warning-icon" aria-hidden="true" />
        <span className="truncate">{definitionDisabledLabel}</span>
        <ChevronRight className="ml-auto h-3 w-3 shrink-0 text-status-warning-icon" aria-hidden="true" />
      </button>
    )
  }

  return (
    <button {...commonProps} className={`${baseClass} border-border bg-muted text-foreground hover:bg-accent`}>
      {triggerCount > 0 ? (
        <>
          <Zap className="h-3 w-3 shrink-0 text-chart-emerald" aria-hidden="true" />
          <span className="truncate text-chart-emerald">{countLabel}</span>
          <span className="text-muted-foreground" aria-hidden="true">
            ·
          </span>
        </>
      ) : (
        <MousePointerClick className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
      <span className="truncate text-muted-foreground">{manualLabel}</span>
      <ChevronRight className="ml-auto h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  )
}
