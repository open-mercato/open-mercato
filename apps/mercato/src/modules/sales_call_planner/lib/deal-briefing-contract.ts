/**
 * The parts of the deal-briefing workflow a BROWSER needs to know.
 *
 * ## Why this file exists at all
 *
 * `lib/seeds.ts` already owned the workflow id, and the header widget (B6) must
 * name the same id — retyping it would fail only at run time, on a button that
 * places a phone call. But `seeds.ts` imports `WorkflowDefinition` and the
 * engine's validators, which pull MikroORM into whatever bundle imports them,
 * and an injection widget is loaded in the CLIENT bundle. So the shared
 * constants live here, in a module with NO imports at all, and `seeds.ts`
 * re-exports the id so every existing importer is unaffected.
 *
 * Everything here is asserted against `examples/deal-briefing-workflow.json` by
 * `__tests__/deal-briefing-contract.test.ts`: a step renamed in the JSON without
 * being renamed here fails a test rather than silently degrading the widget's
 * live status line to "nothing ever happens".
 */

/**
 * The definition's stable id. Carries no version suffix — `findWorkflowDefinition`
 * resolves a run against `workflowId` + `version`, so baking a version into the id
 * would make v2 a different workflow rather than a new version of this one.
 */
export const DEAL_BRIEFING_WORKFLOW_ID = 'sales_call_planner_deal_briefing'

/**
 * `metadata.entityType` for a run started from a company page. It matches the
 * `resourceKind` the company detail page publishes into its injection context,
 * so `GET /api/workflows/instances?entityType=…&entityId=…` finds this run from
 * the same identity the page already knows.
 */
export const DEAL_BRIEFING_ENTITY_TYPE = 'customers.company'

/**
 * The step ids of `examples/deal-briefing-workflow.json`, as the browser reads
 * them off the `workflows.instance.*` lifecycle payload's `stepId`.
 */
export const DEAL_BRIEFING_STEP_IDS = {
  prepareBrief: 'prepare_brief',
  callChief: 'call_chief',
  extractTasks: 'extract_tasks',
  recordTasks: 'record_tasks',
  delivered: 'brief_delivered',
  failed: 'brief_failed',
} as const

/**
 * What the trigger widget shows about a run in flight.
 *
 * `started` is the moment the POST returned and no lifecycle event has arrived
 * yet; the rest are derived from the run itself.
 */
export type BriefRunPhase =
  | 'started'
  | 'briefing'
  | 'calling'
  | 'extracting'
  | 'completed'
  | 'failed'

const TERMINAL_EVENT_PHASES: Record<string, BriefRunPhase> = {
  'workflows.instance.completed': 'completed',
  'workflows.instance.failed': 'failed',
  'workflows.instance.cancelled': 'failed',
}

const STEP_PHASES: Record<string, BriefRunPhase> = {
  [DEAL_BRIEFING_STEP_IDS.prepareBrief]: 'briefing',
  [DEAL_BRIEFING_STEP_IDS.callChief]: 'calling',
  [DEAL_BRIEFING_STEP_IDS.extractTasks]: 'extracting',
  [DEAL_BRIEFING_STEP_IDS.recordTasks]: 'extracting',
  [DEAL_BRIEFING_STEP_IDS.delivered]: 'completed',
  [DEAL_BRIEFING_STEP_IDS.failed]: 'failed',
}

/**
 * Translate one `workflows.instance.*` lifecycle event into the phase the widget
 * should display, or `null` when the event says nothing new.
 *
 * The STEP wins over the event id, and that ordering is the whole point: every
 * failure route of this workflow ends at the `brief_failed` END step, so the run
 * finishes COMPLETED and emits `workflows.instance.completed` even when nobody
 * answered the phone. Reading the event id first would announce a successful
 * briefing for a call that never connected.
 *
 * `workflows.instance.started` is re-emitted on EVERY step advance carrying the
 * destination `stepId` (`workflow-executor.ts`), which is what makes a per-step
 * status line possible without polling.
 */
export function resolveBriefRunPhase(
  eventId: string,
  stepId: string | null | undefined,
): BriefRunPhase | null {
  const fromStep = stepId ? STEP_PHASES[stepId] : undefined
  if (fromStep) return fromStep
  return TERMINAL_EVENT_PHASES[eventId] ?? null
}
