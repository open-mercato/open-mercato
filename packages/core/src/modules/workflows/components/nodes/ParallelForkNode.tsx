'use client'

import { Handle, Position, NodeProps } from '@xyflow/react'
import { WorkflowNodeCard } from '../WorkflowNodeCard'
import { WorkflowStatus } from '../../lib/status-colors'

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

function mapStatus(status?: string): WorkflowStatus {
  if (!status || status === 'pending') return 'not_started'
  if (status === 'running' || status === 'in_progress') return 'in_progress'
  if (status === 'completed') return 'completed'
  return 'not_started'
}

/**
 * ParallelForkNode - splits the workflow into concurrent branches.
 * One target handle (in); one source handle (out) that fans out to each branch.
 */
export function ParallelForkNode({ data, isConnectable, selected }: NodeProps) {
  const nodeData = data as unknown as ParallelForkNodeData

  return (
    <div className="parallel-fork-node" title={nodeData.tooltip}>
      <Handle
        type="target"
        position={Position.Top}
        id="target"
        isConnectable={isConnectable}
        className="!w-3 !h-3 !bg-primary !border-2 !border-background"
      />

      <WorkflowNodeCard
        title={nodeData.label}
        description={nodeData.description}
        status={mapStatus(nodeData.status)}
        nodeType="parallelFork"
        selected={selected}
      />

      <Handle
        type="source"
        position={Position.Bottom}
        id="source"
        isConnectable={isConnectable}
        className="!w-3 !h-3 !bg-primary !border-2 !border-background"
      />
    </div>
  )
}
