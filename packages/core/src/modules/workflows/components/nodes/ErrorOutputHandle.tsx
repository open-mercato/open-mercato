'use client'

import { Handle, Position } from '@xyflow/react'
import { NODE_HANDLE_CLASS } from '../../lib/node-geometry'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ERROR_SOURCE_HANDLE_ID } from '../../lib/error-routing'

export { ERROR_SOURCE_HANDLE_ID }

/**
 * Error output handle. Sits below the node's main source handle on the right so
 * it never collides with the sub-workflow output ports along the bottom edge,
 * and is labelled for pointer and assistive users alike.
 */
export function ErrorOutputHandle({ isConnectable }: { isConnectable?: boolean }) {
  const t = useT()
  const label = t('workflows.nodes.errorHandle', 'On error')

  return (
    <Handle
      type="source"
      position={Position.Right}
      id={ERROR_SOURCE_HANDLE_ID}
      isConnectable={isConnectable}
      title={label}
      aria-label={label}
      data-testid="workflow-error-handle"
      style={{ top: '75%' }}
      className={`${NODE_HANDLE_CLASS} !bg-status-error-icon`}
    />
  )
}
