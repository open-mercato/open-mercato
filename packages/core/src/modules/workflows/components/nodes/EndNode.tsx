'use client'

import { Handle, Position, NodeProps } from '@xyflow/react'
import { NODE_HANDLE_CLASS } from '../../lib/node-geometry'
import { WorkflowNodeCard } from '../WorkflowNodeCard'
import { toWorkflowStatus } from '../../lib/status-colors'

export interface EndNodeData {
  label: string
  description?: string
  status?: 'pending' | 'running' | 'completed' | 'error' | 'not_started' | 'in_progress'
  outcome?: 'success' | 'cancelled' | 'error'
  badge?: string
  tooltip?: string
  executionStatus?: 'completed' | 'active' | 'pending' | 'failed' | 'skipped'
  hasError?: boolean
  hasCompensation?: boolean
  errorCount?: number
}

/**
 * EndNode - End point of a workflow
 * Uses WorkflowNodeCard for consistent styling
 */
export function EndNode({ id, data, isConnectable, selected }: NodeProps) {
  const nodeData = data as unknown as EndNodeData

  const workflowStatus = toWorkflowStatus(nodeData.status)

  return (
    <div className="end-node" title={nodeData.tooltip}>
      {/* Target Handle */}
      <Handle
        type="target"
        position={Position.Left}
        id="target"
        isConnectable={isConnectable}
        className={`${NODE_HANDLE_CLASS} !bg-primary`}
      />

      <WorkflowNodeCard
        title={nodeData.label || 'Complete'}
        description={nodeData.description}
        status={workflowStatus}
        nodeType="end"
        selected={selected}
        hasError={nodeData.hasError}
        hasCompensation={nodeData.hasCompensation}
        errorCount={nodeData.errorCount}
        nodeId={id}
        editable={isConnectable}
        variant="pill"
      />
    </div>
  )
}
