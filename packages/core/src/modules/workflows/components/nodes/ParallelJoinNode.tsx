'use client'

import { Handle, Position, NodeProps } from '@xyflow/react'
import { NODE_HANDLE_CLASS } from '../../lib/node-geometry'
import { WorkflowNodeCard } from '../WorkflowNodeCard'
import { toWorkflowStatus } from '../../lib/status-colors'

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
  hasError?: boolean
  hasCompensation?: boolean
  errorCount?: number
}

/**
 * ParallelJoinNode - synchronizes concurrent branches (wait-all).
 * One target handle (in) collecting all branches; one source handle (out).
 */
export function ParallelJoinNode({ id, data, isConnectable, selected }: NodeProps) {
  const nodeData = data as unknown as ParallelJoinNodeData

  return (
    <div className="parallel-join-node" title={nodeData.tooltip}>
      <Handle
        type="target"
        position={Position.Left}
        id="target"
        isConnectable={isConnectable}
        className={`${NODE_HANDLE_CLASS} !bg-primary`}
      />

      <WorkflowNodeCard
        title={nodeData.label}
        description={nodeData.description}
        status={toWorkflowStatus(nodeData.status)}
        nodeType="parallelJoin"
        selected={selected}
        hasError={nodeData.hasError}
        hasCompensation={nodeData.hasCompensation}
        errorCount={nodeData.errorCount}
        nodeId={id}
        editable={isConnectable}
      />

      <Handle
        type="source"
        position={Position.Right}
        id="source"
        isConnectable={isConnectable}
        className={`${NODE_HANDLE_CLASS} !bg-primary`}
      />
    </div>
  )
}
