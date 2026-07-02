'use client'

import { Handle, Position, NodeProps } from '@xyflow/react'
import { WorkflowNodeCard } from '../WorkflowNodeCard'
import { toWorkflowStatus } from '../../lib/status-colors'

export interface StartNodeData {
  label: string
  description?: string
  status?: 'pending' | 'running' | 'completed' | 'error' | 'not_started' | 'in_progress'
  badge?: string
  tooltip?: string
  executionStatus?: 'completed' | 'active' | 'pending' | 'failed' | 'skipped'
}

/**
 * StartNode - Starting point of a workflow
 * Uses WorkflowNodeCard for consistent styling
 */
export function StartNode({ id, data, isConnectable, selected }: NodeProps) {
  const nodeData = data as unknown as StartNodeData

  const workflowStatus = toWorkflowStatus(nodeData.status)

  return (
    <div className="start-node" title={nodeData.tooltip}>
      <WorkflowNodeCard
        title={nodeData.label || 'Start'}
        description={nodeData.description}
        status={workflowStatus}
        nodeType="start"
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
