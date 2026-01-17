import { EdgeState } from '../lib/status-colors'

interface WorkflowTransitionLabelProps {
  label: string
  state?: EdgeState
}

export function WorkflowTransitionLabel({
  label,
  state = 'pending',
}: WorkflowTransitionLabelProps) {
  if (!label) return null

  return (
    <div
      className={`
        px-2 py-1 text-xs font-medium
        bg-card border rounded
        ${state === 'completed' ? 'border-emerald-300 text-emerald-700' : 'border-border text-muted-foreground'}
      `}
    >
      {label}
    </div>
  )
}
