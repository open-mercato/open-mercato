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
        bg-white border rounded
        ${state === 'completed' ? 'border-emerald-300 text-emerald-700' : 'border-gray-300 text-gray-600'}
      `}
    >
      {label}
    </div>
  )
}
