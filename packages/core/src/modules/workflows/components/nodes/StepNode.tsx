'use client'

import { Handle, Position } from '@xyflow/react'
import { ReactNode } from 'react'

export interface StepNodeData {
  label: string
  stepType?: string
  description?: string
  icon?: ReactNode
  status?: 'active' | 'completed' | 'pending' | 'failed'
}

export interface StepNodeProps {
  data: StepNodeData
  isConnectable?: boolean
  className?: string
  style?: React.CSSProperties
}

/**
 * StepNode - Base component for workflow step nodes
 *
 * Provides common structure for all step types with:
 * - Connection handles (top and bottom)
 * - Icon support
 * - Label and description
 * - Step type badge
 * - Status indicator
 */
export function StepNode({
  data,
  isConnectable = true,
  className = '',
  style = {}
}: StepNodeProps) {
  return (
    <div
      className={`step-node ${className}`}
      style={{
        padding: '16px',
        borderRadius: '8px',
        border: '2px solid #D1D5DB',
        background: '#FFFFFF',
        minWidth: '180px',
        position: 'relative',
        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
        ...style
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={isConnectable}
        style={{
          background: '#6B7280',
          width: 8,
          height: 8,
          border: '2px solid white',
        }}
      />

      <div className="step-content">
        {data.icon && (
          <div className="step-icon" style={{ fontSize: '24px', marginBottom: '8px', textAlign: 'center' }}>
            {data.icon}
          </div>
        )}

        <div className="step-label" style={{ fontWeight: 600, textAlign: 'center', marginBottom: '4px' }}>
          {data.label}
        </div>

        {data.stepType && (
          <div
            className="step-type"
            style={{
              fontSize: '11px',
              textAlign: 'center',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              marginBottom: data.description ? '4px' : '0'
            }}
          >
            {data.stepType}
          </div>
        )}

        {data.description && (
          <div
            className="step-description"
            style={{
              fontSize: '12px',
              textAlign: 'center',
              opacity: 0.8
            }}
          >
            {data.description}
          </div>
        )}

        {data.status && (
          <div
            className="step-status"
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              width: 8,
              height: 8,
              borderRadius: '50%',
              background:
                data.status === 'completed' ? '#10B981' :
                data.status === 'active' ? '#3B82F6' :
                data.status === 'failed' ? '#EF4444' :
                '#9CA3AF'
            }}
          />
        )}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={isConnectable}
        style={{
          background: '#6B7280',
          width: 8,
          height: 8,
          border: '2px solid white',
        }}
      />
    </div>
  )
}
