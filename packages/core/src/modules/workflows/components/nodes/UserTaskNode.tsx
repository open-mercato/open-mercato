'use client'

import { Handle, Position, NodeProps } from '@xyflow/react'
import { NODE_HANDLE_CLASS } from '../../lib/node-geometry'
import { WorkflowNodeCard } from '../WorkflowNodeCard'
import type { StepReason } from '../../lib/step-presentation'
import { toWorkflowStatus } from '../../lib/status-colors'
import { buildNodeConfigSummary } from '../../lib/node-config-summary'
import { ErrorOutputHandle } from './ErrorOutputHandle'
import { NodeOutcomeRows } from './NodeOutcomeRows'
import {
  buildDecisionOutcomeRows,
  buildDefaultRouteRow,
  type DecisionRowLike,
} from '../../lib/node-outcome-rows'
import { DEFAULT_SOURCE_HANDLE_ID } from '../../lib/route-kinds'
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
  const hasDecisionFooter = decisionRows.length > 0

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
        runReason={nodeData.runReason}
        runStartedAt={nodeData.runStartedAt}
        nodeType="userTask"
        selected={selected}
        hasError={nodeData.hasError}
        hasCompensation={nodeData.hasCompensation}
        errorCount={nodeData.errorCount}
        nodeId={id}
        editable={isConnectable}
        footer={
          <NodeOutcomeRows
            rows={decisionRows}
            defaultRow={hasDecisionFooter ? buildDefaultRouteRow() : undefined}
            isConnectable={isConnectable}
            testId="workflow-task-decision-rows"
          />
        }
      />

      {/* The default route joins the decision rows in the footer when there is
          one, so it stops floating over the first decision. A task with no
          authored decisions has no footer, and keeps its handle unchanged. */}
      {!hasDecisionFooter && (
        <Handle
          type="source"
          position={Position.Right}
          id={DEFAULT_SOURCE_HANDLE_ID}
          isConnectable={isConnectable}
          className={`${NODE_HANDLE_CLASS} !bg-primary`}
        />
      )}

      <ErrorOutputHandle isConnectable={isConnectable} />
    </div>
  )
}
