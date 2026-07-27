'use client'

import { Handle, Position, NodeProps } from '@xyflow/react'
import { WorkflowNodeCard } from '../WorkflowNodeCard'
import { toWorkflowStatus } from '../../lib/status-colors'

/**
 * SwitchNode display data.
 *
 * A SWITCH step is pure transition sugar: it completes immediately and its
 * outgoing transitions carry the routing (one generated `field == value`
 * condition per case, plus a required unconditioned otherwise route).
 */
export interface SwitchNodeData {
  label: string
  description?: string
  status?: 'pending' | 'running' | 'completed' | 'error' | 'not_started' | 'in_progress'
  stepNumber?: number
  badge?: string
  tooltip?: string
  executionStatus?: 'completed' | 'active' | 'pending' | 'failed' | 'skipped'
  hasError?: boolean
  errorCount?: number
}

export function SwitchNode({ id, data, isConnectable, selected }: NodeProps) {
  const nodeData = data as unknown as SwitchNodeData

  return (
    <div className="switch-node" title={nodeData.tooltip}>
      <Handle
        type="target"
        position={Position.Left}
        id="target"
        isConnectable={isConnectable}
        className="!w-3 !h-3 !bg-primary !border-2 !border-background"
      />

      <WorkflowNodeCard
        title={nodeData.label}
        description={nodeData.description}
        status={toWorkflowStatus(nodeData.status)}
        nodeType="switch"
        selected={selected}
        hasError={nodeData.hasError}
        errorCount={nodeData.errorCount}
        nodeId={id}
        editable={isConnectable}
      />

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
