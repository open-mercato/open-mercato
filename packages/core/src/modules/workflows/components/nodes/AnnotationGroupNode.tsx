'use client'

import { NodeResizer, type NodeProps } from '@xyflow/react'
import { ChevronDown, ChevronRight, Group, Trash2 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { requestWorkflowNodeDeletion } from '../WorkflowNodeCard'
import { requestWorkflowGroupToggle } from '../../lib/annotation-events'
import type { WorkflowGroupNodeData } from '../../lib/editor-annotations'

/**
 * Named region framing a part of the canvas (spec section 4.5).
 *
 * Collapse is deliberately VISUAL ONLY: the body fades away and the region
 * shrinks to its header, but no step moves and no route changes, because a
 * graph-mutating collapse would be execution semantics — exactly what an
 * annotation must never be.
 */
export function AnnotationGroupNode({ id, data, isConnectable, selected }: NodeProps) {
  const t = useT()
  const groupData = data as unknown as WorkflowGroupNodeData
  const name = typeof groupData?.name === 'string' && groupData.name.length > 0
    ? groupData.name
    : t('workflows.annotations.group.untitled', 'Untitled group')
  const collapsed = groupData?.collapsed === true
  const editable = isConnectable
  const ToggleIcon = collapsed ? ChevronRight : ChevronDown

  return (
    <div
      className={`group flex w-full flex-col overflow-hidden rounded-lg border-2 border-dashed border-border ${
        collapsed ? 'h-auto bg-muted/40' : 'h-full bg-muted/20'
      } ${selected ? 'ring-2 ring-primary' : ''}`}
    >
      <NodeResizer isVisible={editable && selected && !collapsed} minWidth={200} minHeight={140} lineClassName="!border-primary" handleClassName="!bg-primary !border-background" />
      <div className="flex items-center justify-between gap-2 rounded-t-md bg-background/80 px-2.5 py-1">
        <div className="flex min-w-0 items-center gap-1">
          {editable ? (
            <button
              type="button"
              aria-expanded={!collapsed}
              aria-label={collapsed
                ? t('workflows.annotations.group.expand', 'Expand group')
                : t('workflows.annotations.group.collapse', 'Collapse group')}
              className="nodrag nopan flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={(event) => {
                event.stopPropagation()
                event.preventDefault()
                requestWorkflowGroupToggle(id)
              }}
            >
              <ToggleIcon className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : (
            <Group className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          <span className="truncate text-xs font-semibold text-foreground">{name}</span>
          {collapsed && (
            <span className="shrink-0 text-overline uppercase tracking-wide text-muted-foreground">
              {t('workflows.annotations.group.collapsedBadge', 'Collapsed')}
            </span>
          )}
        </div>
        {editable && (
          <button
            type="button"
            aria-label={t('workflows.annotations.group.delete', 'Delete group')}
            className="nodrag nopan -mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-status-error-icon focus-visible:opacity-100 group-hover:opacity-100"
            onClick={(event) => {
              event.stopPropagation()
              event.preventDefault()
              requestWorkflowNodeDeletion(id)
            }}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
      {!collapsed && <div className="min-h-0 flex-1" aria-hidden="true" />}
    </div>
  )
}
