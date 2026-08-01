'use client'

import { MousePointerClick, PowerOff, Zap } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { TriggerNodeModel } from '../../lib/trigger-node'

/**
 * The trigger "cap" (fidelity gap #5, Direction A) — a compact, clickable
 * summary of what starts a workflow, folded onto the START node instead of
 * living in a separate overlay node joined by a dashed connector.
 *
 * It is positioned absolutely ABOVE the START pill by its host (`StartNode`), so
 * it never enters the node's measured box and therefore never affects layout —
 * the same "display-only, no geometry" guarantee the old overlay node aimed for,
 * without the render-only node that caused the re-measure loop.
 *
 * Everything it states is true of the running system (derived in
 * `lib/trigger-node.ts`): the manual/API path is always available because
 * `startWorkflow` needs no trigger, and a disabled definition says nothing
 * starts it at all. Accessibility (spec §4.6): it IS a `<button>`, carries a
 * named `aria-label`, and every state pairs its token colour with a glyph and a
 * label — never colour alone.
 */
export function TriggerCap({ model, onOpen }: { model: TriggerNodeModel; onOpen?: () => void }) {
  const t = useT()
  const { triggerCount, enabledCount, definitionEnabled } = model

  const openLabel = t('workflows.triggerNode.open', 'Edit triggers')
  const manualLabel = t('workflows.triggerNode.manual', 'manual / API start')
  const countLabel = t('workflows.triggerNode.capCount', '{count} triggers', { count: triggerCount })
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

  const baseClass =
    'nodrag nopan inline-flex w-fit max-w-full items-center gap-1 rounded-md border px-2 py-0.5 text-overline font-semibold shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

  if (!definitionEnabled) {
    return (
      <button
        type="button"
        data-testid="workflow-trigger-cap"
        data-trigger-definition-disabled="true"
        aria-label={`${summary}. ${openLabel}`}
        title={openLabel}
        onClick={(event) => {
          event.stopPropagation()
          onOpen?.()
        }}
        className={`${baseClass} border-status-warning-border bg-status-warning-bg text-status-warning-text hover:brightness-95`}
      >
        <PowerOff className="h-3 w-3 shrink-0 text-status-warning-icon" aria-hidden="true" />
        <span className="truncate">{definitionDisabledLabel}</span>
      </button>
    )
  }

  return (
    <button
      type="button"
      data-testid="workflow-trigger-cap"
      aria-label={`${summary}. ${openLabel}`}
      title={openLabel}
      onClick={(event) => {
        event.stopPropagation()
        onOpen?.()
      }}
      className={`${baseClass} border-border bg-muted text-foreground hover:bg-accent`}
    >
      {triggerCount > 0 ? (
        <>
          <Zap className="h-3 w-3 shrink-0 text-chart-emerald" aria-hidden="true" />
          <span className="truncate text-chart-emerald">{countLabel}</span>
          <span className="text-muted-foreground" aria-hidden="true">
            ·
          </span>
        </>
      ) : null}
      <MousePointerClick className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="truncate text-muted-foreground">{manualLabel}</span>
    </button>
  )
}
