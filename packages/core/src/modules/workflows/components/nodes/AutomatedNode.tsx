'use client'

import { Handle, Position, NodeProps } from '@xyflow/react'

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
  status?: 'pending' | 'running' | 'completed' | 'error'
  stepNumber?: number
  badge?: string
}

/**
 * AutomatedNode - Automated/system task step in a workflow
 *
 * White background with gray left accent
 * Represents tasks executed by the system without user interaction
 */
export function AutomatedNode({ data, isConnectable, selected }: NodeProps) {
  const nodeData = data as unknown as AutomatedNodeData
  const status = nodeData.status || 'pending'

  // Status indicator styles
  const statusStyles = {
    pending: 'bg-transparent border-2 border-gray-300',
    running: 'bg-blue-500 text-white',
    completed: 'bg-emerald-500 text-white',
    error: 'bg-red-500 text-white',
  }

  const statusIcons = {
    pending: null,
    running: '⟳',
    completed: '✓',
    error: '!',
  }

  return (
    <div
      className={`
        automated-node
        min-w-[280px] max-w-[320px]
        bg-white rounded-xl border border-l-4 border-l-gray-500
        transition-all duration-150
        ${selected
          ? 'border-[#0080FE] shadow-[0_0_0_3px_rgba(0,128,254,0.15)]'
          : 'border-gray-200 shadow-sm hover:shadow-md hover:border-gray-300'
        }
      `}
      style={{
        position: 'relative',
      }}
    >
      {/* Target Handle */}
      <Handle
        type="target"
        position={Position.Top}
        id="target"
        isConnectable={isConnectable}
        className="!w-3 !h-3 !bg-[#0080FE] !border-2 !border-white"
      />

      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-gray-100">
        {/* Status Indicator */}
        <div
          className={`
            w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0
            text-xs font-semibold
            ${statusStyles[status]}
          `}
        >
          {statusIcons[status]}
        </div>

        {/* Badge */}
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-gray-100 rounded-md">
          <span className="text-xs font-medium text-gray-700">
            {nodeData.badge || 'Automated'}
          </span>
        </div>

        {/* Title */}
        <h3 className="text-sm font-semibold text-gray-900 flex-grow">
          {nodeData.label}
        </h3>
      </div>

      {/* Body */}
      <div className="p-4 pt-3">
        {nodeData.stepNumber && (
          <span className="text-xs font-semibold text-gray-400">
            Step {nodeData.stepNumber}.
          </span>
        )}
        {nodeData.description && (
          <p className="text-sm text-gray-600 leading-relaxed mt-0.5">
            {nodeData.description}
          </p>
        )}
        {nodeData.activityType && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <span className="text-xs text-gray-500">
              {nodeData.activityType}
            </span>
          </div>
        )}
      </div>

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
