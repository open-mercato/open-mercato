'use client'

import { Handle, Position, NodeProps } from '@xyflow/react'
import { WorkflowNodeCard } from '../WorkflowNodeCard'
import { toWorkflowStatus } from '../../lib/status-colors'

/**
 * ParallelForkNode display data.
 *
 * A PARALLEL_FORK splits execution into N branches (one per outgoing `auto`
 * transition) that run concurrently and converge at the paired PARALLEL_JOIN
 * referenced by `joinStepId`.
 */
export interface ParallelForkNodeData {
  label: string
  description?: string
  joinStepId?: string
  status?: 'pending' | 'running' | 'completed' | 'error' | 'not_started' | 'in_progress'
  stepNumber?: number
  badge?: string
  tooltip?: string
  executionStatus?: 'completed' | 'active' | 'pending' | 'failed' | 'skipped'
}

/**
 * ParallelForkNode - splits the workflow into concurrent branches.
 * One target handle (in); one source handle (out) that fans out to each branch.
 */
export function ParallelForkNode({ id, data, isConnectable, selected }: NodeProps) {
  const nodeData = data as unknown as ParallelForkNodeData

  return (
    <div className="parallel-fork-node" title={nodeData.tooltip}>
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
        nodeType="parallelFork"
        selected={selected}
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
