import { CircleDot, CircleStop, User, Zap, Workflow, Clock, Timer, LucideIcon } from 'lucide-react'

export type NodeType = 'start' | 'end' | 'userTask' | 'automated' | 'subWorkflow' | 'waitForSignal' | 'waitForTimer'

export const NODE_TYPE_ICONS: Record<NodeType, LucideIcon> = {
  start: CircleDot,
  end: CircleStop,
  userTask: User,
  automated: Zap,
  subWorkflow: Workflow,
  waitForSignal: Clock,
  waitForTimer: Timer,
}

export const NODE_TYPE_COLORS: Record<NodeType, string> = {
  start: 'text-emerald-500',
  end: 'text-red-500',
  userTask: 'text-blue-500',
  automated: 'text-amber-500',
  subWorkflow: 'text-purple-500',
  waitForSignal: 'text-purple-500',
  waitForTimer: 'text-cyan-500',
}

export const NODE_TYPE_LABELS: Record<NodeType, { title: string; description: string }> = {
  start: { title: 'START', description: 'Workflow trigger' },
  end: { title: 'END', description: 'Workflow completion' },
  userTask: { title: 'USER TASK', description: 'Manual action' },
  automated: { title: 'AUTOMATED', description: 'System task' },
  subWorkflow: { title: 'SUB-WORKFLOW', description: 'Invoke workflow' },
  waitForSignal: { title: 'WAIT FOR SIGNAL', description: 'Pause for external event' },
  waitForTimer: { title: 'WAIT FOR TIMER', description: 'Pause for a duration' },
}

const STEP_TYPE_TO_NODE_TYPE: Record<string, NodeType> = {
  START: 'start',
  END: 'end',
  USER_TASK: 'userTask',
  AUTOMATED: 'automated',
  SUB_WORKFLOW: 'subWorkflow',
  WAIT_FOR_SIGNAL: 'waitForSignal',
  WAIT_FOR_TIMER: 'waitForTimer',
}

export function stepTypeToNodeType(stepType: string): NodeType {
  return STEP_TYPE_TO_NODE_TYPE[stepType] || 'automated'
}
