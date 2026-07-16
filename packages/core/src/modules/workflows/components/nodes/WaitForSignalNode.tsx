'use client'

import { Handle, Position, NodeProps } from '@xyflow/react'
import { WorkflowNodeCard } from '../WorkflowNodeCard'
import { toWorkflowStatus } from '../../lib/status-colors'

export interface WaitForSignalNodeData {
  label: string
  description?: string
  signalName?: string
  version?: number
  status?: 'pending' | 'running' | 'completed' | 'error' | 'not_started' | 'in_progress'
  stepNumber?: number
  badge?: string
  tooltip?: string
  executionStatus?: 'completed' | 'active' | 'pending' | 'failed' | 'skipped'
}

/**
 * WaitForSignalNodeData - Waiting for external signal step in a workflow
 * Uses WorkflowNodeCard for consistent styling
 */
export function WaitForSignalNode({ id, data, isConnectable, selected }: NodeProps) {
  const nodeData = data as unknown as WaitForSignalNodeData

  const workflowStatus = toWorkflowStatus(nodeData.status)

  const description = nodeData.description ||
    (nodeData.signalName  ? `Waiting for signal: ${nodeData.signalName}` : 'Signal invocation')

  return (
    <div className="waiting-for-signal-node" title={nodeData.tooltip}>
      {/* Target Handle */}
      <Handle
        type="target"
        position={Position.Left}
        id="target"
        isConnectable={isConnectable}
        className="!w-3 !h-3 !bg-primary !border-2 !border-background"
      />

      <WorkflowNodeCard
        title={nodeData.label}
        description={description}
        status={workflowStatus}
        nodeType="waitForSignal"
        selected={selected}
        nodeId={id}
        editable={isConnectable}
      />

      {/* Source Handle */}
      <Handle
        type="source"
        position={Position.Right}
        id="source"
        isConnectable={isConnectable}
        className="!w-3 !h-3 !bg-primary !border-2 !border-background"
      />
    </div>
  )
}
