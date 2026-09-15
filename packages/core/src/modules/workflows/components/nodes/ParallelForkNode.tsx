'use client'

import { Handle, Position, NodeProps } from '@xyflow/react'
import { DEFAULT_SOURCE_HANDLE_ID } from '../../lib/route-kinds'
import { NODE_HANDLE_CLASS } from '../../lib/node-geometry'
import { WorkflowNodeCard } from '../WorkflowNodeCard'
import type { StepReason } from '../../lib/step-presentation'
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
  /**
   * Run presentation (spec Part 2). Set at render time by the run detail
   * page and the Studio last-run overlay from the SAME resolver, so the two
   * surfaces can never disagree about what the step is doing.
   */
  runReason?: StepReason | null
  runStartedAt?: Date | null
  hasError?: boolean
  hasCompensation?: boolean
  errorCount?: number
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
        className={`${NODE_HANDLE_CLASS} !bg-primary`}
      />

      <WorkflowNodeCard
        title={nodeData.label}
        description={nodeData.description}
        status={toWorkflowStatus(nodeData.status)}
        runReason={nodeData.runReason}
        runStartedAt={nodeData.runStartedAt}
        nodeType="parallelFork"
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
        id={DEFAULT_SOURCE_HANDLE_ID}
        isConnectable={isConnectable}
        className={`${NODE_HANDLE_CLASS} !bg-primary`}
      />
    </div>
  )
}
