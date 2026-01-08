import { Check, Play, Pause, Circle, CircleDot, User, Zap, CircleStop } from 'lucide-react'
import { STATUS_COLORS, WorkflowStatus } from '../lib/status-colors'

interface WorkflowNodeCardProps {
  title: string
  description?: string
  status?: WorkflowStatus
  nodeType: 'start' | 'end' | 'userTask' | 'automated'
  selected?: boolean
}

export function WorkflowNodeCard({
  title,
  description,
  status = 'not_started',
  nodeType,
  selected = false,
}: WorkflowNodeCardProps) {
  // In edit mode (not_started), use white background
  const isEditMode = status === 'not_started'
  const colors = STATUS_COLORS[status]

  const StatusIcon = {
    completed: Check,
    in_progress: Play,
    pending: Pause,
    not_started: Circle,
  }[status]

  const NodeTypeIcon = {
    start: CircleDot,
    end: CircleStop,
    userTask: User,
    automated: Zap,
  }[nodeType]

  // Node type icon colors
  const nodeTypeIconColor = {
    start: 'text-emerald-500',
    end: 'text-red-500',
    userTask: 'text-blue-500',
    automated: 'text-amber-500',
  }[nodeType]

  return (
    <div
      className={`
        w-[280px] rounded-xl border-2
        ${isEditMode ? 'bg-white border-gray-200' : `${colors.bg} ${colors.border}`}
        transition-all duration-200 relative
        ${
          selected
            ? 'shadow-[0_0_0_3px_rgba(0,128,254,0.15)] border-[#0080FE]'
            : 'shadow-sm hover:shadow-md'
        }
      `}
    >
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
            <p className="mt-1 text-sm text-gray-600 line-clamp-2">
              {description}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
