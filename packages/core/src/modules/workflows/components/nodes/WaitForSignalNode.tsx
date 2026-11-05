'use client'

import { Handle, Position, NodeProps } from '@xyflow/react'
import { DEFAULT_SOURCE_HANDLE_ID } from '../../lib/route-kinds'
import { NODE_HANDLE_CLASS } from '../../lib/node-geometry'
import { WorkflowNodeCard } from '../WorkflowNodeCard'
import type { StepReason } from '../../lib/step-presentation'
import { toWorkflowStatus } from '../../lib/status-colors'
import { buildNodeConfigSummary } from '../../lib/node-config-summary'

export interface WaitForSignalNodeData {
  label: string
  description?: string
  signalName?: string
  version?: number
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
 * WaitForSignalNodeData - Waiting for external signal step in a workflow
 * Uses WorkflowNodeCard for consistent styling
 */
export function WaitForSignalNode({ id, data, isConnectable, selected }: NodeProps) {
  const nodeData = data as unknown as WaitForSignalNodeData

  const workflowStatus = toWorkflowStatus(nodeData.status)
  const summary = buildNodeConfigSummary('waitForSignal', nodeData as never)

  const description = nodeData.description ||
    (nodeData.signalName  ? `Waiting for signal: ${nodeData.signalName}` : 'Signal invocation')

  return (
    <div className="waiting-for-signal-node" title={nodeData.tooltip}>
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
        description={description}
        status={workflowStatus}
        runReason={nodeData.runReason}
        runStartedAt={nodeData.runStartedAt}
        nodeType="waitForSignal"
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
    </div>
  )
}
