import { AlertTriangle, Check } from 'lucide-react'
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
      {/* Spec section 4.6: status is never colour-only — each non-neutral state
          pairs its token colour with its own icon shape. */}
      {state === 'error' ? <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" /> : null}
      {state === 'completed' ? <Check className="h-3 w-3 shrink-0" aria-hidden="true" /> : null}
      {label}
    </div>
  )
}
