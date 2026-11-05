'use client'

import { Handle, Position, NodeProps } from '@xyflow/react'
import { DEFAULT_SOURCE_HANDLE_ID } from '../../lib/route-kinds'
import { NODE_HANDLE_CLASS } from '../../lib/node-geometry'
import { WorkflowNodeCard } from '../WorkflowNodeCard'
import type { StepReason } from '../../lib/step-presentation'
import { toWorkflowStatus } from '../../lib/status-colors'
import { buildNodeConfigSummary } from '../../lib/node-config-summary'
import { ErrorOutputHandle } from './ErrorOutputHandle'

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
 * AutomatedNode - Automated/system task step in a workflow
 * Uses WorkflowNodeCard for consistent styling
 */
export function AutomatedNode({ id, data, isConnectable, selected }: NodeProps) {
  const nodeData = data as unknown as AutomatedNodeData

  const workflowStatus = toWorkflowStatus(nodeData.status)
  const summary = buildNodeConfigSummary('automated', nodeData as never)

  return (
    <div className="automated-node" title={nodeData.tooltip}>
      {/* Target Handle */}
      <Handle
        type="target"
        position={Position.Left}
        id="target"
        isConnectable={isConnectable}
        className={`${NODE_HANDLE_CLASS} !bg-primary`}
      />

      <WorkflowNodeCard
        summary={summary}
        title={nodeData.label}
        description={nodeData.description}
        status={workflowStatus}
        runReason={nodeData.runReason}
        runStartedAt={nodeData.runStartedAt}
        nodeType="automated"
        selected={selected}
        hasError={nodeData.hasError}
        hasCompensation={nodeData.hasCompensation}
        errorCount={nodeData.errorCount}
        nodeId={id}
        editable={isConnectable}
      />

      {/* Source Handle */}
      <Handle
        type="source"
        position={Position.Right}
        id={DEFAULT_SOURCE_HANDLE_ID}
        isConnectable={isConnectable}
        className={`${NODE_HANDLE_CLASS} !bg-primary`}
      />

      <ErrorOutputHandle isConnectable={isConnectable} />
    </div>
  )
}
