'use client'

import { Handle, Position, NodeProps } from '@xyflow/react'
import { WorkflowNodeCard } from '../WorkflowNodeCard'
import { WorkflowStatus } from '../../lib/status-colors'

/**
 * AutomatedNode display data.
 *
 * NOTE: activityType and activityId are populated from transition.activities[]
 * by graph-utils.ts for display purposes only. They are NOT stored on the step
 * in the workflow definition JSON (WorkflowStep schema has no activity fields).
 *
 * Per the workflow schema architecture:
 * - WorkflowStep (validators.ts:122-131) has NO activities field
 * - Activities belong in transition.activities[] only (validators.ts:160)
 * - graph-utils.ts:264-276 extracts activities from transitions for display
 *
 * @see packages/core/src/modules/workflows/lib/graph-utils.ts:264-276
 * @see packages/core/src/modules/workflows/data/validators.ts:122-131
 */
export interface AutomatedNodeData {
  label: string
  description?: string
  activityType?: string
  activityId?: string
  status?: 'pending' | 'running' | 'completed' | 'error' | 'not_started' | 'in_progress'
  stepNumber?: number
  badge?: string
  tooltip?: string
  executionStatus?: 'completed' | 'active' | 'pending' | 'failed' | 'skipped'
}

/**
 * AutomatedNode - Automated/system task step in a workflow
 * Uses WorkflowNodeCard for consistent styling
 */
export function AutomatedNode({ data, isConnectable, selected }: NodeProps) {
  const nodeData = data as unknown as AutomatedNodeData

  // Map old status values to new WorkflowStatus types
  const mapStatus = (status?: string): WorkflowStatus => {
    if (!status || status === 'pending') return 'not_started'
    if (status === 'running' || status === 'in_progress') return 'in_progress'
    if (status === 'completed') return 'completed'
    if (status === 'error') return 'not_started'
    return 'not_started'
  }

  const workflowStatus = mapStatus(nodeData.status)

  return (
    <div className="automated-node" title={nodeData.tooltip}>
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
        description={nodeData.description}
        status={workflowStatus}
        nodeType="automated"
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
