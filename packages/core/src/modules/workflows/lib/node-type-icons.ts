import { CircleDot, CircleStop, User, Zap, Workflow, Clock, LucideIcon } from 'lucide-react'

export type NodeType = 'start' | 'end' | 'userTask' | 'automated' | 'subWorkflow' | 'waitForSignal'

export const NODE_TYPE_ICONS: Record<NodeType, LucideIcon> = {
  start: CircleDot,
  end: CircleStop,
  userTask: User,
  automated: Zap,
  subWorkflow: Workflow,
  waitForSignal: Clock,
}

export const NODE_TYPE_COLORS: Record<NodeType, string> = {
  start: 'text-emerald-500',
  end: 'text-red-500',
  userTask: 'text-blue-500',
  automated: 'text-amber-500',
  subWorkflow: 'text-purple-500',
  waitForSignal: 'text-purple-500',
}

export const NODE_TYPE_LABELS: Record<NodeType, { title: string; description: string }> = {
  start: { title: 'START', description: 'Workflow trigger' },
  end: { title: 'END', description: 'Workflow completion' },
  userTask: { title: 'USER TASK', description: 'Manual action' },
  automated: { title: 'AUTOMATED', description: 'System task' },
  subWorkflow: { title: 'SUB-WORKFLOW', description: 'Invoke workflow' },
  waitForSignal: { title: 'WAIT FOR SIGNAL', description: 'Pause for external event' },
}

const STEP_TYPE_TO_NODE_TYPE: Record<string, NodeType> = {
  START: 'start',
  END: 'end',
  USER_TASK: 'userTask',
  AUTOMATED: 'automated',
  SUB_WORKFLOW: 'subWorkflow',
  WAIT_FOR_SIGNAL: 'waitForSignal',
}

export function stepTypeToNodeType(stepType: string): NodeType {
  return STEP_TYPE_TO_NODE_TYPE[stepType] || 'automated'
}
