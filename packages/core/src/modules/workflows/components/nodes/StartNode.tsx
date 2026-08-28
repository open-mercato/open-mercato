'use client'

import { Handle, Position, NodeProps } from '@xyflow/react'
import { DEFAULT_SOURCE_HANDLE_ID } from '../../lib/route-kinds'
import { NODE_HANDLE_CLASS } from '../../lib/node-geometry'
import { WorkflowNodeCard, WORKFLOW_NODE_TITLE_SLOT } from '../WorkflowNodeCard'
import { STATUS_COLORS, toWorkflowStatus } from '../../lib/status-colors'
import { NODE_TYPE_COLORS, NODE_TYPE_ICONS } from '../../lib/node-type-icons'
import { TriggerCap } from './TriggerCap'
import type { TriggerNodeModel } from '../../lib/trigger-node'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export interface StartNodeData {
  label: string
  description?: string
  status?: 'pending' | 'running' | 'completed' | 'error' | 'not_started' | 'in_progress'
  badge?: string
  tooltip?: string
  executionStatus?: 'completed' | 'active' | 'pending' | 'failed' | 'skipped'
  hasError?: boolean
  hasCompensation?: boolean
  errorCount?: number
  /**
   * The definition's triggers, folded onto the START node as a clickable cap
   * (fidelity gap #5, Direction A). Injected at render time by
   * `WorkflowGraphImpl`; absent in read-only viewers, which then render no cap.
   */
  trigger?: TriggerNodeModel
  onOpenTriggers?: () => void
}

/**
 * StartNode — the workflow's entry point.
 *
 * Without triggers it is a terminal pill (`WorkflowNodeCard`). WITH triggers it
 * becomes ONE unified card: the trigger cap as an attached header row above the
 * Start row (mockup #9), rather than two detached pills. The source handle is
 * nested in the Start row so it stays centred on "Start" even though the card is
 * taller — and the card is not `overflow-hidden`, so the handle can overhang.
 */
export function StartNode({ id, data, isConnectable, selected }: NodeProps) {
  const nodeData = data as unknown as StartNodeData
  const t = useT()
  const workflowStatus = toWorkflowStatus(nodeData.status)

  if (nodeData.trigger) {
    const colors = STATUS_COLORS[workflowStatus]
    const isEditMode = workflowStatus === 'not_started'
    const StartIcon = NODE_TYPE_ICONS.start
    const statusLabel = t(`workflows.nodeStatus.${workflowStatus}`, workflowStatus)
    const bodyBackground = isEditMode ? 'bg-card' : colors.bg
    const borderClass = selected ? 'border-primary' : isEditMode ? 'border-border' : colors.border
    const elevationClass = selected ? 'ring-2 ring-primary' : 'shadow-sm hover:shadow-md'

    return (
      <div
        role="group"
        aria-label={`${nodeData.label || 'Start'} — ${statusLabel}`}
        data-node-status={workflowStatus}
        data-node-variant="start-card"
        title={nodeData.tooltip}
        className={`start-node w-fit rounded-lg border ${borderClass} ${bodyBackground} transition-all duration-200 ${elevationClass}`}
      >
        <TriggerCap model={nodeData.trigger} onOpen={nodeData.onOpenTriggers} variant="header" />
        <div className="relative flex items-center gap-2 px-4 py-2">
          <span className="sr-only">{statusLabel}</span>
          <StartIcon className={`h-4 w-4 shrink-0 ${NODE_TYPE_COLORS.start}`} aria-hidden="true" />
          <span
            data-slot={WORKFLOW_NODE_TITLE_SLOT}
            className={`truncate text-sm font-semibold leading-snug ${colors.text}`}
          >
            {nodeData.label || 'Start'}
          </span>
          {/* Nested in the Start row so React Flow centres it on "Start", not on
              the taller cap+row card. */}
          <Handle
            type="source"
            position={Position.Right}
            id={DEFAULT_SOURCE_HANDLE_ID}
            isConnectable={isConnectable}
            className={`${NODE_HANDLE_CLASS} !bg-primary`}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="start-node relative" title={nodeData.tooltip}>
      <WorkflowNodeCard
        title={nodeData.label || 'Start'}
        description={nodeData.description}
        status={workflowStatus}
        nodeType="start"
        selected={selected}
        hasError={nodeData.hasError}
        hasCompensation={nodeData.hasCompensation}
        errorCount={nodeData.errorCount}
        nodeId={id}
        editable={isConnectable}
        variant="pill"
      />

      {/* Source Handle */}
      <Handle
        type="source"
        position={Position.Right}
        id={DEFAULT_SOURCE_HANDLE_ID}
        isConnectable={isConnectable}
        className={`${NODE_HANDLE_CLASS} !bg-primary`}
      />
    </div>
  )
}
