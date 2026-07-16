import { Check, Play, Pause, Circle, XCircle, Trash2 } from 'lucide-react'
import { STATUS_COLORS, WorkflowStatus } from '../lib/status-colors'
import { NODE_TYPE_ICONS, NODE_TYPE_COLORS, NODE_TYPE_LABELS, NodeType } from '../lib/node-type-icons'

/** Rendered node sizing. Cards size to their content between these bounds; the
 * dagre layout mirrors the same bounds when estimating per-node footprints. */
export const NODE_MIN_WIDTH = 180
export const NODE_MAX_WIDTH = 280
/** @deprecated kept for back-compat; prefer NODE_MIN_WIDTH/NODE_MAX_WIDTH. */
export const NODE_WIDTH = NODE_MIN_WIDTH

/**
 * Dispatched when a node's inline trash button is clicked. The visual editor
 * listens for this on `window` and runs its confirm + edge-cleanup delete flow,
 * so the card stays decoupled from the page (no callback threaded through every
 * node component or the graph-utils data transform).
 */
export const WORKFLOW_NODE_DELETE_EVENT = 'workflow-node:delete'

export function requestWorkflowNodeDeletion(nodeId: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(WORKFLOW_NODE_DELETE_EVENT, { detail: { nodeId } }))
}

interface WorkflowNodeCardProps {
  title: string
  description?: string
  status?: WorkflowStatus
  nodeType: NodeType
  selected?: boolean
  /** Node id — required to render the inline delete affordance. */
  nodeId?: string
  /** When true (and `nodeId` is set), show the hover/selected trash button. */
  editable?: boolean
}

export function WorkflowNodeCard({
  title,
  description,
  status = 'not_started',
  nodeType,
  selected = false,
  nodeId,
  editable = false,
}: WorkflowNodeCardProps) {
  // In edit mode (not_started), use white background
  const isEditMode = status === 'not_started'
  const colors = STATUS_COLORS[status]

  const StatusIcon = {
    completed: Check,
    in_progress: Play,
    pending: Pause,
    failed: XCircle,
    paused: Pause,
    not_started: Circle,
  }[status]

  const NodeTypeIcon = NODE_TYPE_ICONS[nodeType]
  const nodeTypeIconColor = NODE_TYPE_COLORS[nodeType]
  const nodeTypeLabel = NODE_TYPE_LABELS[nodeType]?.title ?? nodeType
  const showDelete = editable && !!nodeId

  return (
    <div
      style={{ minWidth: NODE_MIN_WIDTH, maxWidth: NODE_MAX_WIDTH }}
      className={`
        group w-fit rounded-lg border
        ${isEditMode ? 'bg-card border-border' : `${colors.bg} ${colors.border}`}
        transition-all duration-200 relative
        ${
          selected
            ? 'ring-2 ring-primary border-primary'
            : 'shadow-sm hover:shadow-md'
        }
      `}
    >
      {/* Type label + (editable) inline delete */}
      <div className="flex items-center justify-between gap-2 px-2.5 pt-2">
        <div className="flex min-w-0 items-center gap-1">
          <NodeTypeIcon className={`h-3 w-3 shrink-0 ${nodeTypeIconColor}`} />
          <span className="truncate text-overline font-semibold uppercase tracking-wide text-muted-foreground">
            {nodeTypeLabel}
          </span>
        </div>
        {showDelete && (
          <button
            type="button"
            aria-label="Delete step"
            className="nodrag nopan -mr-1 -mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-status-error-icon focus-visible:opacity-100 group-hover:opacity-100"
            onClick={(event) => {
              event.stopPropagation()
              event.preventDefault()
              requestWorkflowNodeDeletion(nodeId!)
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="flex items-start gap-2 px-2.5 pb-2.5 pt-1">
        <div className={`mt-0.5 flex-shrink-0 ${colors.icon}`}>
          <StatusIcon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className={`break-words text-sm font-semibold leading-snug ${colors.text}`}>
            {title}
          </h3>
          {description && (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
