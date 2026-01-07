'use client'

import { Handle, Position, NodeProps } from '@xyflow/react'

export interface StartNodeData {
  label: string
  description?: string
  status?: 'pending' | 'running' | 'completed' | 'error'
  badge?: string
}

/**
 * StartNode - Starting point of a workflow
 *
 * White background with emerald left accent
 * Only has source handle (no input)
 */
export function StartNode({ data, isConnectable, selected }: NodeProps) {
  const nodeData = data as unknown as StartNodeData
  const status = nodeData.status || 'completed'

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
        start-node
        min-w-[280px] max-w-[320px]
        bg-white rounded-xl border border-l-4 border-l-emerald-500
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
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 border border-emerald-200 rounded-md">
          <span className="text-xs font-medium text-emerald-700">
            {nodeData.badge || 'Trigger'}
          </span>
        </div>

        {/* Title */}
        <h3 className="text-sm font-semibold text-gray-900 flex-grow">
          {nodeData.label || 'Start'}
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
