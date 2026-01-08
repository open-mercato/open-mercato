'use client'

import { Handle, Position, NodeProps } from '@xyflow/react'
import { WorkflowNodeCard } from '../WorkflowNodeCard'
import { WorkflowStatus } from '../../lib/status-colors'

export interface EndNodeData {
  label: string
  description?: string
  status?: 'pending' | 'running' | 'completed' | 'error' | 'not_started' | 'in_progress'
  outcome?: 'success' | 'cancelled' | 'error'
  badge?: string
  tooltip?: string
  executionStatus?: 'completed' | 'active' | 'pending' | 'failed' | 'skipped'
}

/**
 * EndNode - End point of a workflow
 * Uses WorkflowNodeCard for consistent styling
 */
export function EndNode({ data, isConnectable, selected }: NodeProps) {
  const nodeData = data as unknown as EndNodeData

  // Map old status values to new WorkflowStatus types
  const mapStatus = (status?: string): WorkflowStatus => {
    if (!status || status === 'pending') return 'not_started'
    if (status === 'running' || status === 'in_progress') return 'in_progress'
    if (status === 'completed') return 'completed'
    if (status === 'error') return 'not_started'
    return 'not_started'
  }

  const workflowStatus = mapStatus(nodeData.status)

  return (
    <div className="end-node" title={nodeData.tooltip}>
      {/* Target Handle */}
      <Handle
        type="target"
        position={Position.Top}
        id="target"
        isConnectable={isConnectable}
        className="!w-3 !h-3 !bg-[#0080FE] !border-2 !border-white"
      />

      <WorkflowNodeCard
        title={nodeData.label || 'Complete'}
        description={nodeData.description}
        status={workflowStatus}
        nodeType="end"
        selected={selected}
      />
    </div>
  )
}
