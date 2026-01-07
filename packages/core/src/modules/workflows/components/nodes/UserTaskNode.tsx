'use client'

import { Handle, Position, NodeProps } from '@xyflow/react'

export interface UserTaskNodeData {
  label: string
  description?: string
  assignedTo?: string
  assignedToRoles?: string[]
  formKey?: string
  status?: 'pending' | 'running' | 'completed' | 'error'
  stepNumber?: number
  badge?: string
}

/**
 * UserTaskNode - User task step in a workflow
 *
 * White background with amber left accent
 * Shows assignment information if available
 */
export function UserTaskNode({ data, isConnectable, selected }: NodeProps) {
  const nodeData = data as unknown as UserTaskNodeData
  const assignmentInfo = nodeData.assignedTo || nodeData.assignedToRoles?.join(', ')
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
        user-task-node
        min-w-[280px] max-w-[320px]
        bg-white rounded-xl border border-l-4 border-l-amber-500
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
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 border border-amber-200 rounded-md">
          <span className="text-xs font-medium text-amber-700">
            {nodeData.badge || 'User Task'}
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
        {assignmentInfo && (
          <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
            <span>👤</span>
            <span>Assigned: {assignmentInfo}</span>
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
