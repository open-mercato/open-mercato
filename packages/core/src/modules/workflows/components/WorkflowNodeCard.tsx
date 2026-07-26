'use client'

import { Check, Play, Pause, Circle, CircleAlert } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { STATUS_COLORS, WorkflowStatus } from '../lib/status-colors'
import { NODE_TYPE_ICONS, NODE_TYPE_COLORS, NodeType } from '../lib/node-type-icons'

interface WorkflowNodeCardProps {
  title: string
  description?: string
  status?: WorkflowStatus
  nodeType: NodeType
  selected?: boolean
  hasError?: boolean
  errorCount?: number
}

export function WorkflowNodeCard({
  title,
  description,
  status = 'not_started',
  nodeType,
  selected = false,
  hasError = false,
  errorCount,
}: WorkflowNodeCardProps) {
  const t = useT()
  // In edit mode (not_started), use white background
  const isEditMode = status === 'not_started'
  const colors = STATUS_COLORS[status]

  const StatusIcon = {
    completed: Check,
    in_progress: Play,
    pending: Pause,
    not_started: Circle,
    error: CircleAlert,
  }[status]

  const NodeTypeIcon = NODE_TYPE_ICONS[nodeType]
  const nodeTypeIconColor = NODE_TYPE_COLORS[nodeType]

  const backgroundClass = isEditMode ? 'bg-card' : colors.bg
  const borderClass = selected
    ? 'border-[#0080FE]'
    : hasError
      ? 'border-status-error-border'
      : isEditMode
        ? 'border-border'
        : colors.border
  const errorBadgeLabel = t(
    'workflows.visualEditor.problems.nodeErrorBadge',
    '{count} validation error(s)',
    { count: typeof errorCount === 'number' && errorCount > 0 ? errorCount : 1 },
  )

  return (
    <div
      className={`
        w-[280px] rounded-xl border-2
        ${backgroundClass} ${borderClass}
        transition-all duration-200 relative
        ${
          selected
            ? 'shadow-[0_0_0_3px_rgba(0,128,254,0.15)]'
            : 'shadow-sm hover:shadow-md'
        }
      `}
    >
      {hasError && (
        <span
          role="status"
          aria-label={errorBadgeLabel}
          title={errorBadgeLabel}
          className="absolute -top-2 -right-2 z-10 inline-flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-background bg-status-error-icon px-1 text-xs font-bold text-primary-foreground"
        >
          {typeof errorCount === 'number' && errorCount > 0 ? (
            errorCount
          ) : (
            <CircleAlert className="h-3 w-3" aria-hidden="true" />
          )}
        </span>
      )}

      {/* Subtle node type indicator in upper right */}
      <div className="absolute top-2 right-2">
        <NodeTypeIcon className={`w-3.5 h-3.5 ${nodeTypeIconColor}`} />
      </div>

      <div className="p-4 flex items-start gap-3">
        <div className={`flex-shrink-0 mt-0.5 ${colors.icon}`}>
          <StatusIcon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0 pr-4">
          <h3 className={`font-semibold text-base ${colors.text} truncate`}>
            {title}
          </h3>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
              {description}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
