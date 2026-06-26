'use client'

import { Handle, Position, NodeProps } from '@xyflow/react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { WorkflowNodeCard } from '../WorkflowNodeCard'
import { WorkflowStatus } from '../../lib/status-colors'
import type { PortField } from '../../data/validators'

export interface SubWorkflowNodeData {
  label: string
  description?: string
  subWorkflowId?: string
  subWorkflowName?: string
  version?: number
  status?: 'pending' | 'running' | 'completed' | 'error' | 'not_started' | 'in_progress'
  stepNumber?: number
  badge?: string
  tooltip?: string
  executionStatus?: 'completed' | 'active' | 'pending' | 'failed' | 'skipped'
  /** Declared input/output ports of the referenced sub-workflow (definition.io). */
  inputs?: PortField[]
  outputs?: PortField[]
}

/**
 * SubWorkflowNode - Sub-workflow invocation step in a workflow.
 *
 * Renders the referenced child's declared IN/OUT ports (when supplied via node
 * data) so a business user can see and target each field without opening the
 * child. Per-port data handles use stable ids `in:<name>` / `out:<name>`; the
 * top/bottom control-flow handles are unchanged, so existing transitions keep
 * connecting. Falls back to the plain card when no contract is present.
 */
export function SubWorkflowNode({ data, isConnectable, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as unknown as SubWorkflowNodeData
  const inputs = Array.isArray(nodeData.inputs) ? nodeData.inputs : []
  const outputs = Array.isArray(nodeData.outputs) ? nodeData.outputs : []

  const mapStatus = (status?: string): WorkflowStatus => {
    if (!status || status === 'pending') return 'not_started'
    if (status === 'running' || status === 'in_progress') return 'in_progress'
    if (status === 'completed') return 'completed'
    if (status === 'error') return 'not_started'
    return 'not_started'
  }

  const workflowStatus = mapStatus(nodeData.status)

  const description = nodeData.description ||
    (nodeData.subWorkflowName
      ? `Invokes: ${nodeData.subWorkflowName}${nodeData.version ? ` v${nodeData.version}` : ''}`
      : nodeData.subWorkflowId
        ? `Invokes: ${nodeData.subWorkflowId}`
        : 'Sub-workflow invocation')

  return (
    <div className="sub-workflow-node" title={nodeData.tooltip}>
      {/* Control-flow target handle (unchanged) */}
      <Handle
        type="target"
        position={Position.Top}
        id="target"
        isConnectable={isConnectable}
        className="!w-3 !h-3 !bg-primary !border-2 !border-background"
      />

      <WorkflowNodeCard
        title={nodeData.label}
        description={description}
        status={workflowStatus}
        nodeType="subWorkflow"
        selected={selected}
      />

      {(inputs.length > 0 || outputs.length > 0) && (
        <div className="mt-1 rounded-md border border-border bg-background text-xs overflow-hidden">
          {inputs.length > 0 && (
            <div className="px-3 py-1.5">
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                {t('workflows.ports.inputs')}
              </div>
              {inputs.map((port) => (
                <div key={port.name} className="relative flex items-center justify-between gap-3 py-0.5">
                  <Handle
                    type="target"
                    position={Position.Left}
                    id={`in:${port.name}`}
                    isConnectable={isConnectable}
                    className="!w-2.5 !h-2.5 !bg-primary !border !border-background"
                  />
                  <span className="truncate text-foreground">{port.label || port.name}</span>
                  <span className="shrink-0 text-muted-foreground">{t(`workflows.ports.types.${port.type}`)}</span>
                </div>
              ))}
            </div>
          )}
          {outputs.length > 0 && (
            <div className="px-3 py-1.5 border-t border-border">
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                {t('workflows.ports.outputs')}
              </div>
              {outputs.map((port) => (
                <div key={port.name} className="relative flex items-center justify-between gap-3 py-0.5">
                  <span className="truncate text-foreground">{port.label || port.name}</span>
                  <span className="shrink-0 text-muted-foreground">{t(`workflows.ports.types.${port.type}`)}</span>
                  <Handle
                    type="source"
                    position={Position.Right}
                    id={`out:${port.name}`}
                    isConnectable={isConnectable}
                    className="!w-2.5 !h-2.5 !bg-muted-foreground !border !border-background"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Control-flow source handle (unchanged) */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="source"
        isConnectable={isConnectable}
        className="!w-3 !h-3 !bg-primary !border-2 !border-background"
      />
    </div>
  )
}
