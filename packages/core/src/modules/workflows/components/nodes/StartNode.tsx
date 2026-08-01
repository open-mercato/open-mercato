'use client'

import { Handle, Position, NodeProps } from '@xyflow/react'
import { DEFAULT_SOURCE_HANDLE_ID } from '../../lib/route-kinds'
import { NODE_HANDLE_CLASS } from '../../lib/node-geometry'
import { WorkflowNodeCard } from '../WorkflowNodeCard'
import { toWorkflowStatus } from '../../lib/status-colors'
import { TriggerCap } from './TriggerCap'
import type { TriggerNodeModel } from '../../lib/trigger-node'

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
 * StartNode - Starting point of a workflow
 * Uses WorkflowNodeCard for consistent styling
 */
export function StartNode({ id, data, isConnectable, selected }: NodeProps) {
  const nodeData = data as unknown as StartNodeData

  const workflowStatus = toWorkflowStatus(nodeData.status)

  return (
    <div className="start-node relative" title={nodeData.tooltip}>
      {/* The trigger cap floats above the pill, out of the node's measured box,
          so it adds no height to the terminal and never enters layout. */}
      {nodeData.trigger ? (
        <div className="absolute bottom-full left-0 mb-1 w-max">
          <TriggerCap model={nodeData.trigger} onOpen={nodeData.onOpenTriggers} />
        </div>
      ) : null}

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
