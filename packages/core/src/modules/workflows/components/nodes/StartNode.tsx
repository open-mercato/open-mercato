'use client'

import { Handle, Position, NodeProps } from '@xyflow/react'
import { DEFAULT_SOURCE_HANDLE_ID } from '../../lib/route-kinds'
import { NODE_HANDLE_CLASS } from '../../lib/node-geometry'
import { WorkflowNodeCard } from '../WorkflowNodeCard'
import { toWorkflowStatus } from '../../lib/status-colors'

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
