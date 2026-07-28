import { AlertTriangle } from 'lucide-react'
import { EdgeState } from '../lib/status-colors'

interface WorkflowTransitionLabelProps {
  label: string
  state?: EdgeState
}

const STATE_CLASSES: Record<EdgeState, string> = {
  completed: 'border-status-success-border text-status-success-text',
  pending: 'border-border text-muted-foreground',
  error: 'border-status-error-border text-status-error-text',
}

export function WorkflowTransitionLabel({
  label,
  state = 'pending',
}: WorkflowTransitionLabelProps) {
  if (!label) return null

  return (
    <div
      className={`
        inline-flex items-center gap-1 px-2 py-1 text-xs font-medium
        bg-card border rounded
        ${STATE_CLASSES[state] ?? STATE_CLASSES.pending}
      `}
    >
      {state === 'error' ? <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" /> : null}
      {label}
    </div>
  )
}
