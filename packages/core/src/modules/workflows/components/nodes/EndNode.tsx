'use client'

import { Handle, Position, NodeProps } from '@xyflow/react'

export interface EndNodeData {
  label: string
  description?: string
  status?: 'pending' | 'running' | 'completed' | 'error'
  outcome?: 'success' | 'cancelled' | 'error'
  badge?: string
}

/**
 * EndNode - End point of a workflow
 *
 * White background with gray left accent
 * Only has target handle (no output)
 */
export function EndNode({ data, isConnectable, selected }: NodeProps) {
  const nodeData = data as unknown as EndNodeData
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
        end-node
        min-w-[240px] max-w-[280px]
        bg-white rounded-xl border border-l-4 border-l-gray-600
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
            {nodeData.badge || 'End'}
          </span>
        </div>

        {/* Title */}
        <h3 className="text-sm font-semibold text-gray-900 flex-grow">
          {nodeData.label || 'Complete'}
        </h3>
      </div>

      {/* Body */}
      {nodeData.description && (
        <div className="p-4 pt-3">
          <p className="text-sm text-gray-600 leading-relaxed">
            {nodeData.description}
          </p>
        </div>
      )}
    </div>
  )
}
