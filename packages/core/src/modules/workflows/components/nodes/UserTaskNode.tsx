'use client'

import { Handle, Position, NodeProps } from '@xyflow/react'
import { NODE_HANDLE_CLASS } from '../../lib/node-geometry'
import { WorkflowNodeCard } from '../WorkflowNodeCard'
import { toWorkflowStatus } from '../../lib/status-colors'
import { buildNodeConfigSummary } from '../../lib/node-config-summary'
import { ErrorOutputHandle } from './ErrorOutputHandle'
import { NodeOutcomeRows } from './NodeOutcomeRows'
import { buildDecisionOutcomeRows, type DecisionRowLike } from '../../lib/node-outcome-rows'
import { useLocale } from '@open-mercato/shared/lib/i18n/context'

export interface UserTaskNodeData {
  label: string
  description?: string
  assignedTo?: string
  assignedToRoles?: string[]
  formKey?: string
  status?: 'pending' | 'running' | 'completed' | 'error' | 'not_started' | 'in_progress'
  stepNumber?: number
  badge?: string
  tooltip?: string
  executionStatus?: 'completed' | 'active' | 'pending' | 'failed' | 'skipped'
  hasError?: boolean
  hasCompensation?: boolean
  errorCount?: number
  /**
   * Authored decision buttons (spec §6.1). Each already binds to a durable
   * `transitionId`, so the footer row's dot IS the route the button takes — no
   * engine work was needed for this half of the footer.
   */
  decisions?: DecisionRowLike[]
}

/**
 * UserTaskNode - User task step in a workflow
 * Uses WorkflowNodeCard for consistent styling
 */
export function UserTaskNode({ id, data, isConnectable, selected }: NodeProps) {
  const nodeData = data as unknown as UserTaskNodeData
  const locale = useLocale()

  const workflowStatus = toWorkflowStatus(nodeData.status)
  const summary = buildNodeConfigSummary('userTask', nodeData as never)
  const decisionRows = buildDecisionOutcomeRows(nodeData.decisions, locale)

  return (
    <div className="user-task-node" title={nodeData.tooltip}>
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
        nodeType="userTask"
        selected={selected}
        hasError={nodeData.hasError}
        hasCompensation={nodeData.hasCompensation}
        errorCount={nodeData.errorCount}
        nodeId={id}
        editable={isConnectable}
        footer={<NodeOutcomeRows rows={decisionRows} isConnectable={isConnectable} testId="workflow-task-decision-rows" />}
      />

      {/* Source Handle */}
      <Handle
        type="source"
        position={Position.Right}
        id="source"
        isConnectable={isConnectable}
        className={`${NODE_HANDLE_CLASS} !bg-primary`}
      />

      <ErrorOutputHandle isConnectable={isConnectable} />
    </div>
  )
}
