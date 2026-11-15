'use client'

import { Handle, Position, NodeProps } from '@xyflow/react'
import { DEFAULT_SOURCE_HANDLE_ID } from '../../lib/route-kinds'
import { NODE_HANDLE_CLASS } from '../../lib/node-geometry'
import { WorkflowNodeCard } from '../WorkflowNodeCard'
import type { StepReason } from '../../lib/step-presentation'
import { toWorkflowStatus } from '../../lib/status-colors'

/**
 * WaitForConditionNode display data.
 *
 * A WAIT_FOR_CONDITION step pauses the workflow — or a single parallel branch —
 * until a predicate over the run context holds. It always carries a timeout, so
 * a stuck predicate surfaces as a timed-out step rather than a hung run.
 */
export interface WaitForConditionNodeData {
  label: string
  description?: string
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

export function WaitForConditionNode({ id, data, isConnectable, selected }: NodeProps) {
  const nodeData = data as unknown as WaitForConditionNodeData

  return (
    <div className="wait-for-condition-node" title={nodeData.tooltip}>
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
        nodeType="waitForCondition"
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
