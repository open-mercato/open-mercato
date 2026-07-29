'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Ban, MousePointerClick, MoreHorizontal, Play, PowerOff, Zap } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { NODE_HANDLE_CLASS, NODE_MAX_WIDTH } from '../../lib/node-geometry'
import type { TriggerNodeModel } from '../../lib/trigger-node'

/**
 * The handle sits level with the pill's own centre rather than the node's, so
 * the connector leaves the lozenge and not the tag stack under it.
 */
const TRIGGER_HANDLE_TOP = 16

/**
 * The canvas trigger node (fidelity gap #5) — "where does this start", answered
 * on the canvas instead of three clicks deep in the details drawer.
 *
 * A terminal pill carrying dashed event tags, which is the mockup's own
 * vocabulary: the dashed border is the canvas's ONLY "this is metadata, not a
 * step" signal, and keeping it rare is what keeps it legible.
 *
 * Everything it states is derived in `lib/trigger-node.ts` and is true of the
 * running system: the manual/API line is unconditional because
 * `workflowExecutor.startWorkflow` needs no trigger, a disabled trigger is
 * marked rather than hidden, and a disabled definition says that nothing starts
 * it at all.
 *
 * Accessibility (spec §4.6 acceptance criterion, not a polish item): the pill IS
 * a `<button>`, so the node is reachable and activatable without a pointer and
 * opens the same drawer section a click does. Every state — disabled trigger,
 * disabled definition — pairs its token colour with its own glyph AND a named
 * `sr-only` label, so nothing here is communicated by colour alone.
 */
export function TriggerNode({ data }: NodeProps) {
  const t = useT()
  const nodeData = data as unknown as { model?: TriggerNodeModel; onOpen?: () => void }
  const model = nodeData.model
  if (!model) return null

  const { rows, hiddenCount, triggerCount, enabledCount, definitionEnabled } = model

  const title = t('workflows.triggerNode.title', 'Starts')
  const openLabel = t('workflows.triggerNode.open', 'Edit triggers')
  const manualLabel = t('workflows.triggerNode.manual', 'manual / API start')
  const disabledTriggerLabel = t('workflows.triggerNode.triggerDisabled', 'disabled')
  const definitionDisabledLabel = t(
    'workflows.triggerNode.definitionDisabled',
    'workflow disabled — nothing starts it',
  )
  const moreLabel = t('workflows.triggerNode.more', '+{count} more', { count: hiddenCount })
  const summary = definitionEnabled
    ? t(
        'workflows.triggerNode.summary',
        '{enabled} of {total} event trigger(s) active, plus manual and API start',
        { enabled: enabledCount, total: triggerCount },
      )
    : definitionDisabledLabel

  return (
    <div className="flex w-fit flex-col items-start gap-1" style={{ maxWidth: NODE_MAX_WIDTH }}>
      <button
        type="button"
        data-testid="workflow-trigger-node"
        aria-label={`${title}: ${summary}. ${openLabel}`}
        title={openLabel}
        onClick={(event) => {
          event.stopPropagation()
          nodeData.onOpen?.()
        }}
        className="nodrag nopan inline-flex w-fit max-w-full items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Play className="h-3.5 w-3.5 shrink-0 text-chart-emerald" aria-hidden="true" />
        <span className="truncate text-sm font-semibold text-foreground">{title}</span>
      </button>

      {/* A disabled definition is started by NOTHING — `startWorkflow` throws
          `DEFINITION_DISABLED` before it looks at a trigger — so the node states
          that instead of listing entry points as though they could fire. The
          triggers themselves are one click away, in the drawer this pill opens. */}
      <ul className="flex w-full flex-col items-start gap-0.5" data-testid="workflow-trigger-node-rows">
        {definitionEnabled && rows.map((row) => (
          <li
            key={row.key}
            data-trigger-row={row.eventPattern}
            data-trigger-enabled={row.enabled ? 'true' : 'false'}
            title={row.name}
            className="inline-flex max-w-full items-center gap-1 rounded-md border border-dashed border-border bg-card px-2 py-0.5"
          >
            {row.enabled ? (
              <Zap className="h-3 w-3 shrink-0 text-chart-emerald" aria-hidden="true" />
            ) : (
              <Ban className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
            <span className="truncate font-mono text-overline text-muted-foreground">
              {row.eventPattern}
            </span>
            {row.enabled ? null : <span className="sr-only">{disabledTriggerLabel}</span>}
          </li>
        ))}

        {definitionEnabled && hiddenCount > 0 && (
          <li
            data-trigger-overflow={hiddenCount}
            className="inline-flex max-w-full items-center gap-1 rounded-md border border-dashed border-border bg-card px-2 py-0.5"
          >
            <MoreHorizontal className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate text-overline text-muted-foreground">{moreLabel}</span>
          </li>
        )}

        {definitionEnabled ? (
          <li
            data-trigger-manual="true"
            className="inline-flex max-w-full items-center gap-1 rounded-md border border-dashed border-border bg-card px-2 py-0.5"
          >
            <MousePointerClick className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate text-overline text-muted-foreground">{manualLabel}</span>
          </li>
        ) : (
          <li
            data-trigger-definition-disabled="true"
            className="inline-flex max-w-full items-center gap-1 rounded-md border border-dashed border-status-warning-border bg-card px-2 py-0.5"
          >
            <PowerOff className="h-3 w-3 shrink-0 text-status-warning-icon" aria-hidden="true" />
            <span className="truncate text-overline text-status-warning-text">
              {definitionDisabledLabel}
            </span>
          </li>
        )}
      </ul>

      {/* Anchors the connector into START. Never connectable: the pill is not a
          step and must not become the source of a real transition. */}
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className={`${NODE_HANDLE_CLASS} !bg-muted-foreground`}
        style={{ top: TRIGGER_HANDLE_TOP }}
      />
    </div>
  )
}
