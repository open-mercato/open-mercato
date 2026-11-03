/**
 * Workflow-event tone classification (spec §8.3) — PURE.
 *
 * The instance viewer used to classify event types inline with hardcoded
 * Tailwind shades (`bg-orange-100`, `bg-blue-100`, …), which is both a DS
 * violation and untestable. The mapping is data, so it lives here and every
 * surface that renders an event badge reads the same answer.
 */

export type RunEventTone = 'success' | 'error' | 'warning' | 'info' | 'neutral'

/**
 * Matched most-specific first. A `COMPENSATION_ACTIVITY_FAILED` is a failure
 * before it is a compensation event — the previous inline chain answered
 * "compensation" for it, which painted a real failure the same warning colour
 * as a routine rollback step.
 */
const TONE_RULES: ReadonlyArray<{ tone: RunEventTone; matches: (eventType: string) => boolean }> = [
  { tone: 'error', matches: (type) => type.includes('FAILED') || type.includes('Failed') },
  { tone: 'error', matches: (type) => type.includes('REJECTED') || type.includes('TIMEOUT') },
  { tone: 'warning', matches: (type) => type.startsWith('COMPENSAT') || type.includes('Compensation') },
  { tone: 'warning', matches: (type) => type.startsWith('ERROR_') || type === 'OUTCOME_UNHANDLED' },
  { tone: 'warning', matches: (type) => type.includes('ESCALATED') || type.includes('PAUSED') },
  { tone: 'neutral', matches: (type) => type.includes('CANCELLED') || type.includes('SKIPPED') },
  { tone: 'success', matches: (type) => type.includes('COMPLETED') || type.includes('EXITED') || type.includes('Exited') },
  { tone: 'info', matches: (type) => type.includes('STARTED') || type.includes('ENTERED') || type.includes('Entered') },
  { tone: 'info', matches: (type) => type.includes('EXECUTED') || type.includes('ROUTED') || type.includes('RECEIVED') },
]

export function classifyRunEventType(eventType: string): RunEventTone {
  for (const rule of TONE_RULES) {
    if (rule.matches(eventType)) return rule.tone
  }
  return 'neutral'
}

/** Events that describe the run's shape rather than its bookkeeping. */
export function isRunMilestoneEvent(eventType: string): boolean {
  return (
    eventType.startsWith('STEP_')
    || eventType.startsWith('WORKFLOW_')
    || eventType.startsWith('TRANSITION_')
    || eventType.startsWith('ERROR_')
    || eventType.startsWith('OUTCOME_')
  )
}
