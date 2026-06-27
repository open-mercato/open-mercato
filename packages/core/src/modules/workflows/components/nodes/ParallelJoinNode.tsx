'use client'

import { Handle, Position, NodeProps } from '@xyflow/react'
import { WorkflowNodeCard } from '../WorkflowNodeCard'
import { WorkflowStatus } from '../../lib/status-colors'

/**
 * ParallelJoinNode display data.
 *
 * A PARALLEL_JOIN synchronizes the branches created by its paired
 * PARALLEL_FORK (`forkStepId`) using wait-all semantics, then continues the
 * single outgoing transition once every branch has completed.
 */
export interface ParallelJoinNodeData {
  label: string
  description?: string
  forkStepId?: string
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
 * ParallelJoinNode - synchronizes concurrent branches (wait-all).
 * One target handle (in) collecting all branches; one source handle (out).
 */
export function ParallelJoinNode({ data, isConnectable, selected }: NodeProps) {
  const nodeData = data as unknown as ParallelJoinNodeData

  return (
    <div className="parallel-join-node" title={nodeData.tooltip}>
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
        status={mapStatus(nodeData.status)}
        nodeType="parallelJoin"
        selected={selected}
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
