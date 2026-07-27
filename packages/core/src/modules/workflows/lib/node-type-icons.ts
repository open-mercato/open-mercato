import { CircleDot, CircleStop, User, Zap, Workflow, Clock, Timer, Split, Merge, Bot, GitBranch, ListTree, Filter, LucideIcon } from 'lucide-react'

export type NodeType = 'start' | 'end' | 'userTask' | 'automated' | 'subWorkflow' | 'waitForSignal' | 'waitForTimer' | 'waitForCondition' | 'parallelFork' | 'parallelJoin' | 'invokeAgent' | 'ifElse' | 'switch'

export const NODE_TYPE_ICONS: Record<NodeType, LucideIcon> = {
  start: CircleDot,
  end: CircleStop,
  userTask: User,
  automated: Zap,
  subWorkflow: Workflow,
  waitForSignal: Clock,
  waitForTimer: Timer,
  waitForCondition: Filter,
  parallelFork: Split,
  parallelJoin: Merge,
  invokeAgent: Bot,
  ifElse: GitBranch,
  switch: ListTree,
}

export const NODE_TYPE_COLORS: Record<NodeType, string> = {
  start: 'text-status-success-icon',
  end: 'text-status-error-icon',
  // Decorative node-type accents (not status semantics): no 1:1 semantic DS
  // token exists for these hues, so they are intentionally left as accent
  // shades to avoid mislabeling them with status meaning.
  userTask: 'text-blue-500',
  automated: 'text-amber-500',
  subWorkflow: 'text-purple-500',
  waitForSignal: 'text-purple-500',
  waitForTimer: 'text-cyan-500',
  // Predicate wait is a routing/guard construct, not a status indicator.
  waitForCondition: 'text-primary',
  // New nodes use a semantic token (DS rule: no hardcoded color shades).
  parallelFork: 'text-primary',
  parallelJoin: 'text-primary',
  // AI / agent touchpoint — brand-violet is reserved for AI features (DS rule).
  invokeAgent: 'text-brand-violet',
  // Branching nodes share the parallel-split semantic token: they are routing
  // constructs, not status indicators.
  ifElse: 'text-primary',
  switch: 'text-primary',
}

export const NODE_TYPE_LABELS: Record<NodeType, { title: string; description: string }> = {
  start: { title: 'START', description: 'Workflow trigger' },
  end: { title: 'END', description: 'Workflow completion' },
  userTask: { title: 'USER TASK', description: 'Manual action' },
  automated: { title: 'AUTOMATED', description: 'System task' },
  subWorkflow: { title: 'SUB-WORKFLOW', description: 'Invoke workflow' },
  waitForSignal: { title: 'WAIT FOR SIGNAL', description: 'Pause for external event' },
  waitForTimer: { title: 'WAIT FOR TIMER', description: 'Pause for a duration' },
  waitForCondition: { title: 'WAIT FOR CONDITION', description: 'Pause until a condition holds' },
  parallelFork: { title: 'PARALLEL FORK', description: 'Split into parallel branches' },
  parallelJoin: { title: 'PARALLEL JOIN', description: 'Wait for all branches' },
  invokeAgent: { title: 'INVOKE AGENT', description: 'Run an AI agent' },
  ifElse: { title: 'IF / ELSE', description: 'Route on a condition' },
  switch: { title: 'SWITCH', description: 'Route on one field value' },
}

const STEP_TYPE_TO_NODE_TYPE: Record<string, NodeType> = {
  START: 'start',
  END: 'end',
  USER_TASK: 'userTask',
  AUTOMATED: 'automated',
  SUB_WORKFLOW: 'subWorkflow',
  WAIT_FOR_SIGNAL: 'waitForSignal',
  WAIT_FOR_TIMER: 'waitForTimer',
  WAIT_FOR_CONDITION: 'waitForCondition',
  PARALLEL_FORK: 'parallelFork',
  PARALLEL_JOIN: 'parallelJoin',
  // The Invoke-Agent node compiles to an AUTOMATED step carrying a single
  // INVOKE_AGENT activity; the editor detects that activity to round-trip it
  // back to this node type (see graph-utils mapStepToNodeType). This synthetic
  // entry keeps the lookup table complete for any caller keying off the
  // activity type directly.
  INVOKE_AGENT: 'invokeAgent',
  IF_ELSE: 'ifElse',
  SWITCH: 'switch',
}

export function stepTypeToNodeType(stepType: string): NodeType {
  return STEP_TYPE_TO_NODE_TYPE[stepType] || 'automated'
}
