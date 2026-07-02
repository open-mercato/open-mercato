'use client'

import { Handle, Position, NodeProps } from '@xyflow/react'
import { WorkflowNodeCard } from '../WorkflowNodeCard'
import { toWorkflowStatus } from '../../lib/status-colors'
import { useT } from '@open-mercato/shared/lib/i18n/context'

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

  const workflowStatus = toWorkflowStatus(nodeData.status)

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
        className="!w-3 !h-3 !bg-brand-violet !border-2 !border-background"
      />

      <div className="relative">
        <WorkflowNodeCard
          title={nodeData.label}
          description={description}
          status={workflowStatus}
          nodeType="invokeAgent"
          selected={selected}
          nodeId={id}
          editable={isConnectable}
        />
        {chip && (
          <span
            className={`absolute bottom-2 right-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${chip.className}`}
          >
            {chip.label}
          </span>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        id="source"
        isConnectable={isConnectable}
        className="!w-3 !h-3 !bg-brand-violet !border-2 !border-background"
      />
    </div>
  )
}
