'use client'

import { Handle, Position, NodeProps } from '@xyflow/react'
import { WorkflowNodeCard } from '../WorkflowNodeCard'
import { WorkflowStatus } from '../../lib/status-colors'

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
export function WaitForSignalNode({ data, isConnectable, selected }: NodeProps) {
  const nodeData = data as unknown as WaitForSignalNodeData

  // Map old status values to new WorkflowStatus types
  const mapStatus = (status?: string): WorkflowStatus => {
    if (!status || status === 'pending') return 'not_started'
    if (status === 'running' || status === 'in_progress') return 'in_progress'
    if (status === 'completed') return 'completed'
    if (status === 'error') return 'not_started'
    return 'not_started'
  }

  const workflowStatus = mapStatus(nodeData.status)

  const description = nodeData.description ||
    (nodeData.signalName  ? `Waiting for signal: ${nodeData.signalName}` : 'Signal invocation')

  return (
    <div className="waiting-for-signal-node" title={nodeData.tooltip}>
      {/* Target Handle */}
      <Handle
        type="target"
        position={Position.Top}
        id="target"
        isConnectable={isConnectable}
        className="!w-3 !h-3 !bg-[#0080FE] !border-2 !border-white"
      />

      <WorkflowNodeCard
        title={nodeData.label}
        description={description}
        status={workflowStatus}
        nodeType="waitForSignal"
        selected={selected}
      />

      {/* Source Handle */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="source"
        isConnectable={isConnectable}
        className="!w-3 !h-3 !bg-[#0080FE] !border-2 !border-white"
      />
    </div>
  )
}
