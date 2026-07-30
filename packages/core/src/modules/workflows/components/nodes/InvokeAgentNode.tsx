'use client'

import { useState } from 'react'
import { Handle, Position, NodeProps } from '@xyflow/react'
import { NODE_HANDLE_CLASS } from '../../lib/node-geometry'
import { WorkflowNodeCard } from '../WorkflowNodeCard'
import type { StepReason } from '../../lib/step-presentation'
import { toWorkflowStatus } from '../../lib/status-colors'
import { buildNodeConfigSummary } from '../../lib/node-config-summary'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ErrorOutputHandle } from './ErrorOutputHandle'
import { NodeOutcomeRows } from './NodeOutcomeRows'
import {
  buildAllAgentOutcomeRows,
  buildDefaultRouteRow,
  type NodeOutcomeRow,
} from '../../lib/node-outcome-rows'
import { DEFAULT_SOURCE_HANDLE_ID } from '../../lib/route-kinds'

export interface InvokeAgentNodeData {
  label: string
  description?: string
  agentId?: string
  activities?: Array<{ activityType?: string; config?: { agentId?: string } }>
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
   * Disposition outcome rows (spec §7.2), derived from the committed edges by
   * `WorkflowGraphImpl` at RENDER time — never part of the saved definition.
   */
  outcomeRows?: NodeOutcomeRow[]
}

/**
 * InvokeAgentNode - Runs an AI agent (area 02b).
 *
 * AI-accented (brand-violet via NODE_TYPE_COLORS.invokeAgent). Shows the target
 * agent id plus a status chip (running / waiting / done) using the same
 * status-badge token pattern as other status surfaces. The node compiles to an
 * AUTOMATED step carrying a single INVOKE_AGENT activity (see NodeEditDialog +
 * graph-utils); `agentId` here is for display only.
 */
export function InvokeAgentNode({ id, data, isConnectable, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as unknown as InvokeAgentNodeData
  const [showAllOutcomes, setShowAllOutcomes] = useState(false)
  const availableOutcomeRows = buildAllAgentOutcomeRows()
  const outcomeRows = showAllOutcomes ? availableOutcomeRows : (nodeData.outcomeRows ?? [])
  const canRevealOutcomes = Boolean(
    isConnectable && !showAllOutcomes && outcomeRows.length < availableOutcomeRows.length,
  )
  const hasOutcomeFooter = outcomeRows.length > 0
  const defaultRouteRow = buildDefaultRouteRow()

  const workflowStatus = toWorkflowStatus(nodeData.status)
  const summary = buildNodeConfigSummary('invokeAgent', nodeData as never)

  const agentId =
    nodeData.agentId ||
    nodeData.activities?.find((activity) => activity.activityType === 'INVOKE_AGENT')?.config?.agentId

  const description =
    nodeData.description ||
    (agentId
      ? t('workflows.invokeAgent.runsAgent', { agentId })
      : t('workflows.invokeAgent.noAgent'))

  // Status chip: running / waiting (parked for a human) / done.
  const chip = (() => {
    if (workflowStatus === 'completed') {
      return {
        label: t('workflows.invokeAgent.statusDone'),
        className: 'bg-status-success-bg text-status-success-text',
      }
    }
    if (workflowStatus === 'in_progress') {
      return {
        label: t('workflows.invokeAgent.statusRunning'),
        className: 'bg-status-info-bg text-status-info-text',
      }
    }
    if (nodeData.executionStatus === 'active') {
      return {
        label: t('workflows.invokeAgent.statusWaiting'),
        className: 'bg-status-warning-bg text-status-warning-text',
      }
    }
    return null
  })()

  return (
    <div className="invoke-agent-node" title={nodeData.tooltip}>
      <Handle
        type="target"
        position={Position.Left}
        id="target"
        isConnectable={isConnectable}
        className={`${NODE_HANDLE_CLASS} !bg-brand-violet`}
      />

      <div className="relative">
        <WorkflowNodeCard
          summary={summary}
          title={nodeData.label}
          description={description}
          status={workflowStatus}
          runReason={nodeData.runReason}
          runStartedAt={nodeData.runStartedAt}
          nodeType="invokeAgent"
          selected={selected}
          hasError={nodeData.hasError}
        hasCompensation={nodeData.hasCompensation}
          errorCount={nodeData.errorCount}
          nodeId={id}
          editable={isConnectable}
          footer={
            <NodeOutcomeRows
              rows={outcomeRows}
              defaultRow={hasOutcomeFooter ? defaultRouteRow : undefined}
              isConnectable={isConnectable}
              inheritanceNote={t(
                'workflows.outcomes.inheritsErrorDirective',
                'unhandled → error directive',
              )}
              revealLabel={
                canRevealOutcomes
                  ? t('workflows.outcomes.add', '+ outcome')
                  : undefined
              }
              onReveal={canRevealOutcomes ? () => setShowAllOutcomes(true) : undefined}
              testId="workflow-agent-outcome-rows"
            />
          }
        />
        {chip && (
          <span
            className={`absolute bottom-2 right-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${chip.className}`}
          >
            {chip.label}
          </span>
        )}
      </div>

      {/* The default route leaves from the footer's last row whenever there is
          a footer, so it shares the outcome rows' x-position, size and rhythm
          instead of floating over the first of them. Without a footer there is
          nothing to hang it off, so it stays exactly where it always was. */}
      {!hasOutcomeFooter && (
        <Handle
          type="source"
          position={Position.Right}
          id={DEFAULT_SOURCE_HANDLE_ID}
          isConnectable={isConnectable}
          className={`${NODE_HANDLE_CLASS} !bg-brand-violet`}
        />
      )}

      <ErrorOutputHandle isConnectable={isConnectable} />
    </div>
  )
}
