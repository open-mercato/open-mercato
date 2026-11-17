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

/**
 * Node TYPE is categorical, node STATUS is semantic — two different channels
 * that used to fight over the card's border. Type now comes from the `chart-*`
 * palette, which the DS ships expressly for categorical encoding
 * (`.ai/ds-rules.md` - Data Visualization), so the card's border and background
 * are free to speak only for run status. This also retires the raw Tailwind
 * shades (`text-blue-500`, `text-amber-500`, ...) that had no guaranteed
 * dark-mode value.
 */
export const NODE_TYPE_COLORS: Record<NodeType, string> = {
  start: 'text-status-success-icon',
  end: 'text-status-error-icon',
  userTask: 'text-chart-amber',
  automated: 'text-chart-blue',
  subWorkflow: 'text-chart-violet',
  waitForSignal: 'text-chart-teal',
  waitForTimer: 'text-chart-teal',
  // Predicate wait is a routing/guard construct, not a status indicator.
  waitForCondition: 'text-primary',
  parallelFork: 'text-primary',
  parallelJoin: 'text-primary',
  // AI / agent touchpoint — brand-violet is reserved for AI features (DS rule),
  // so it stays on brand-violet rather than moving to chart-violet.
  invokeAgent: 'text-brand-violet',
  // Branching nodes share the parallel-split semantic token: they are routing
  // constructs, not status indicators.
  ifElse: 'text-primary',
  switch: 'text-primary',
}

/**
 * The 3px painted cap along the top of a node card. Because it is a
 * `border-top` rather than a child element it sits inside the card's radius and
 * reads as part of the object. Rendered with `border-t-4` — the DS scale's
 * nearest step, one pixel heavier than the design mock and visually
 * indistinguishable from it; `border-t-[3px]` would be an arbitrary value and
 * is not DS-legal.
 *
 * Terminals carry no accent (the design draws them as pills, not capped
 * cards), so they resolve to the same `--border` the rest of the card uses.
 */
export const NODE_TYPE_ACCENTS: Record<NodeType, string> = {
  start: 'border-t-border',
  end: 'border-t-border',
  userTask: 'border-t-chart-amber',
  automated: 'border-t-chart-blue',
  subWorkflow: 'border-t-chart-violet',
  waitForSignal: 'border-t-chart-teal',
  waitForTimer: 'border-t-chart-teal',
  waitForCondition: 'border-t-primary',
  parallelFork: 'border-t-primary',
  parallelJoin: 'border-t-primary',
  invokeAgent: 'border-t-brand-violet',
  ifElse: 'border-t-primary',
  switch: 'border-t-primary',
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
