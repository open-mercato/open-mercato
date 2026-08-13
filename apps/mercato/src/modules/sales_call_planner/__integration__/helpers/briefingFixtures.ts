/**
 * Fixtures for the deal-briefing chain.
 *
 * ## The shadow definition, and exactly how far it is from the real one
 *
 * `examples/deal-briefing-workflow.json` names three agents. Two of them
 * (`sales_call_planner.deal_brief`, `sales_call_planner.task_extractor`) are
 * NATIVE researchers that call a language model, and the third
 * (`sales_call_planner.sales_chief_call`) is an EXTERNAL agent on the ElevenLabs
 * connector, which places a real telephone call to a real person. Neither may
 * run in an integration suite: one is non-deterministic and costs tokens, the
 * other dials.
 *
 * So these specs drive a SHADOW definition that keeps everything the seam
 * actually consists of and substitutes only the two things that cannot run:
 *
 * | Real definition                        | Shadow                                    |
 * |----------------------------------------|-------------------------------------------|
 * | `prepare_brief` (native LLM agent)      | dropped; `context.brief` is start input   |
 * | `call_chief` (ElevenLabs external)      | `probe.echo` external, same seam          |
 * | `extract_tasks` (native LLM agent)      | dropped; `context.plan` is start input    |
 * | `record_tasks` UPDATE_ENTITY + EMIT     | **byte-identical config**                 |
 * | every failure route's EMIT_EVENT        | **byte-identical config**                 |
 *
 * The substituted halves are the two the ~330 unit tests already cover
 * (`__tests__/ai-agents.test.ts` pins both outcome envelopes). What no unit test
 * can reach — and what these specs exist for — is the part that crosses four
 * processes: the web request that starts the instance, the queue worker that
 * reaches the connector, the UNAUTHENTICATED callback the provider makes, and
 * the transition that then writes CRM rows and raises a notification.
 *
 * `assertShadowMatchesShippedDefinition` reads the shipped JSON and fails if the
 * command id, the event names, the cause literals or the UPDATE_ENTITY input
 * shape ever drift from what these specs assert, so the shadow cannot quietly
 * stop describing the feature.
 */

import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, type APIRequestContext } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createWorkflowDefinitionFixture,
  getWorkflowInstanceSnapshot,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'
import {
  DEAL_BRIEFING_WORKFLOW_ID,
  DEAL_BRIEFING_ENTITY_TYPE,
} from '../../lib/deal-briefing-contract'
import {
  BRIEF_COMPLETED_EVENT_ID,
  BRIEF_FAILED_EVENT_ID,
} from '../../events'
/**
 * The shipped definition is READ, not imported.
 *
 * Playwright loads these specs as ESM, where a plain `import … from '*.json'`
 * throws `needs an import attribute of "type: json"` — and because the config
 * builds one `testMatch` list, that single throw took the ENTIRE repository's
 * discovery to "Total: 0 tests in 0 files". A JSON import in an integration
 * spec is therefore not a local style choice; it disables the whole suite.
 */
function readShippedDefinition(): unknown {
  const relative = 'apps/mercato/src/modules/sales_call_planner/examples/deal-briefing-workflow.json'
  let directory = process.cwd()
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(directory, relative)
    if (existsSync(candidate)) return JSON.parse(readFileSync(candidate, 'utf8'))
    const parent = path.dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  throw new Error(`[internal] could not locate ${relative} from ${process.cwd()}`)
}

const shippedDefinition = readShippedDefinition()

export { DEAL_BRIEFING_WORKFLOW_ID, DEAL_BRIEFING_ENTITY_TYPE, BRIEF_COMPLETED_EVENT_ID, BRIEF_FAILED_EVENT_ID }

/** Re-exported so a spec imports one module, not four. */
export {
  advanceQueue,
  postSignedCallback,
  probeCallbackUrl,
  probeConnectorAvailable,
  PROBE_AGENT_ID,
  PROBE_UNAVAILABLE_REASON,
  readProbeStarts,
  scopedRequest,
  superadminScope,
  type Scoped,
} from '../../../agent_probe/__integration__/helpers/externalAgentFixtures'

import {
  advanceQueue,
  readProbeStarts,
  scopedRequest,
  type Scoped,
} from '../../../agent_probe/__integration__/helpers/externalAgentFixtures'

export const ENSURE_TASK_COMMAND_ID = 'sales_call_planner.ensure_task'
export const INVOKE_AGENT_SIGNAL_NAME = 'agent_orchestrator.proposal.ready'
export const VOICE_AGENT_ID = 'sales_call_planner.sales_chief_call'

/** The two answers the shadow's IF_ELSE branches on, standing in for `call.reached`. */
export const ANSWER_REACHED = 'reached'
export const ANSWER_NOT_REACHED = 'not_reached'

export type ShadowTask = {
  title: string
  body?: string
  dueAt?: string
  priority?: 'low' | 'medium' | 'high' | 'urgent'
}

/**
 * Poll until `read` answers with something truthy, or give up.
 *
 * Everything here is genuinely asynchronous — `INVOKE_AGENT` rides a delayed
 * queue job, the callback resumes the instance from a different request — so a
 * single read would be a race rather than an assertion.
 */
export async function poll<T>(
  read: () => Promise<T | null>,
  timeoutMs = 90_000,
  intervalMs = 1_000,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await read()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return null
}

type ShippedDefinition = {
  definition: {
    transitions: Array<{
      transitionId: string
      activities?: Array<{ activityType: string; config: Record<string, unknown> }>
    }>
  }
}

function shippedTransition(transitionId: string) {
  const found = (shippedDefinition as ShippedDefinition).definition.transitions.find(
    (transition) => transition.transitionId === transitionId,
  )
  expect(found, `examples/deal-briefing-workflow.json should still carry ${transitionId}`).toBeTruthy()
  return found as NonNullable<typeof found>
}

/**
 * The shadow only means something while it still describes the shipped graph.
 * Every spec calls this first: a renamed command, a renamed event or a changed
 * UPDATE_ENTITY input shape fails here, loudly, instead of leaving five green
 * specs proving a workflow nobody ships.
 */
export function assertShadowMatchesShippedDefinition(): void {
  const recorded = shippedTransition('t_tasks_recorded')
  const ensure = recorded.activities?.find((activity) => activity.activityType === 'UPDATE_ENTITY')
  expect(ensure?.config.commandId).toBe(ENSURE_TASK_COMMAND_ID)
  expect(ensure?.config.input).toEqual({
    workflowInstanceId: '{{workflow.instanceId}}',
    stepId: '{{workflow.currentStepId}}',
    entityId: '{{context.companyId}}',
    tasks: '{{context.plan.tasks}}',
  })

  const completed = recorded.activities?.find((activity) => activity.activityType === 'EMIT_EVENT')
  expect(completed?.config.eventName).toBe(BRIEF_COMPLETED_EVENT_ID)

  const notReached = shippedTransition('t_not_reached').activities?.[0]
  expect(notReached?.activityType).toBe('EMIT_EVENT')
  expect(notReached?.config.eventName).toBe(BRIEF_FAILED_EVENT_ID)
  expect((notReached?.config.payload as { cause?: string })?.cause).toBe('callNotReached')

  const tasksFailed = shippedTransition('t_tasks_failed').activities?.[0]
  expect((tasksFailed?.config.payload as { cause?: string })?.cause).toBe('taskCreationFailed')
}

function failedEventActivity(activityId: string, cause: string) {
  return {
    activityId,
    activityName: activityId,
    activityType: 'EMIT_EVENT',
    config: {
      eventName: BRIEF_FAILED_EVENT_ID,
      payload: {
        companyId: '{{context.companyId}}',
        companyName: "{{ context.companyName | default('') }}",
        workflowInstanceId: '{{workflow.instanceId}}',
        cause,
      },
    },
  }
}

/**
 * The shadow graph. `record_tasks`' transitions are copied from the shipped
 * definition verbatim, which is what makes an assertion about CRM rows or a
 * notification an assertion about the real feature.
 */
export function buildShadowDefinitionPayload(params: {
  workflowId: string
  workflowName: string
  externalRunId: string
}) {
  return {
    workflowId: params.workflowId,
    workflowName: params.workflowName,
    version: 1,
    enabled: true,
    definition: {
      contextSchema: {
        input: {
          fields: [
            { name: 'companyId', type: 'text', label: 'Company id', required: true },
            { name: 'companyName', type: 'text', label: 'Company name' },
          ],
        },
      },
      steps: [
        { stepId: 'start', stepName: 'Briefing requested', stepType: 'START' },
        {
          stepId: 'call_chief',
          stepName: 'Call the chief of sales',
          stepType: 'AUTOMATED',
          signalConfig: { signalName: INVOKE_AGENT_SIGNAL_NAME },
          activities: [
            {
              activityId: 'invoke_sales_chief_call',
              activityName: 'sales_chief_call',
              activityType: 'INVOKE_AGENT',
              config: {
                agentId: 'probe.echo',
                input: {
                  brief: '{{context.brief.spokenSummary}}',
                  forceExternalRunId: params.externalRunId,
                },
                onResult: { alwaysAsk: true },
                outputMapping: { callAnswer: 'data.answer' },
              },
            },
          ],
        },
        { stepId: 'check_reached', stepName: 'Did anyone answer?', stepType: 'IF_ELSE' },
        { stepId: 'record_tasks', stepName: 'Record the follow-up tasks', stepType: 'AUTOMATED' },
        { stepId: 'brief_delivered', stepName: 'Briefing delivered', stepType: 'END' },
        { stepId: 'brief_failed', stepName: 'Briefing did not complete', stepType: 'END' },
      ],
      transitions: [
        {
          transitionId: 't_start',
          transitionName: 'Begin briefing',
          fromStepId: 'start',
          toStepId: 'call_chief',
          trigger: 'auto',
          priority: 100,
        },
        {
          transitionId: 't_call_settled',
          transitionName: 'Call settled',
          fromStepId: 'call_chief',
          toStepId: 'check_reached',
          trigger: 'auto',
          priority: 100,
          kind: 'outcome',
          outcomeKind: 'researcher',
        },
        {
          transitionId: 't_call_error',
          transitionName: 'Call failed',
          fromStepId: 'call_chief',
          toStepId: 'brief_failed',
          trigger: 'auto',
          priority: 90,
          kind: 'outcome',
          outcomeKind: 'error',
          activities: [failedEventActivity('emit_failed_call_error', 'agentError')],
        },
        {
          transitionId: 't_reached',
          transitionName: 'The chief of sales answered',
          fromStepId: 'check_reached',
          toStepId: 'record_tasks',
          trigger: 'auto',
          priority: 100,
          condition: { field: 'callAnswer', operator: '==', value: ANSWER_REACHED },
        },
        {
          transitionId: 't_not_reached',
          transitionName: 'Nobody answered',
          fromStepId: 'check_reached',
          toStepId: 'brief_failed',
          trigger: 'auto',
          priority: 0,
          activities: [failedEventActivity('emit_failed_not_reached', 'callNotReached')],
        },
        {
          transitionId: 't_tasks_recorded',
          transitionName: 'Follow-up tasks written',
          fromStepId: 'record_tasks',
          toStepId: 'brief_delivered',
          trigger: 'auto',
          priority: 100,
          activities: [
            {
              activityId: 'ensure_follow_up_tasks',
              activityName: 'ensure_tasks',
              activityType: 'UPDATE_ENTITY',
              config: {
                commandId: ENSURE_TASK_COMMAND_ID,
                input: {
                  workflowInstanceId: '{{workflow.instanceId}}',
                  stepId: '{{workflow.currentStepId}}',
                  entityId: '{{context.companyId}}',
                  tasks: '{{context.plan.tasks}}',
                },
              },
            },
            {
              activityId: 'emit_brief_completed',
              activityName: 'announce_completed',
              activityType: 'EMIT_EVENT',
              config: {
                eventName: BRIEF_COMPLETED_EVENT_ID,
                payload: {
                  companyId: '{{context.companyId}}',
                  companyName: "{{ context.companyName | default('') }}",
                  workflowInstanceId: '{{workflow.instanceId}}',
                  taskCount: '{{context.ensure_tasks.result.ensured}}',
                },
              },
            },
          ],
        },
        {
          transitionId: 't_tasks_failed',
          transitionName: 'Follow-up tasks could not be written',
          fromStepId: 'record_tasks',
          toStepId: 'brief_failed',
          trigger: 'auto',
          priority: 0,
          kind: 'error',
          activities: [failedEventActivity('emit_failed_task_creation', 'taskCreationFailed')],
        },
      ],
    },
  }
}

/** What the button posts, minus the two agent outputs the shadow supplies itself. */
export function buildShadowInitialContext(params: {
  companyEntityId: string
  companyName: string
  tasks: ShadowTask[]
}) {
  return {
    companyId: params.companyEntityId,
    companyName: params.companyName,
    brief: { spokenSummary: 'Two deals are stalled and both need a decision this week.' },
    plan: { tasks: params.tasks },
  }
}

export async function superadminToken(request: APIRequestContext): Promise<string> {
  return getAuthToken(request, 'superadmin')
}

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'

/** Absolute URL for a path, honouring `BASE_URL` exactly as the probe helpers do. */
export function briefingUrl(path: string): string {
  return path.startsWith('http') ? path : `${BASE_URL}${path}`
}

// --------------------------------------------------------------------------
// Tenant enablement of the ensure-task command (operator gate #1)
// --------------------------------------------------------------------------

export type CommandSettings = { configured: boolean; enabledCommandIds: string[] }

export async function readCommandSettings(
  request: APIRequestContext,
  scope: Scoped,
): Promise<CommandSettings> {
  const res = await scopedRequest(request, 'GET', '/api/workflows/command-settings', scope)
  expect(res.status(), 'GET /api/workflows/command-settings should return 200').toBe(200)
  const body = (await res.json()) as {
    configured?: boolean
    items?: Array<{ commandId: string; enabled: boolean }>
  }
  return {
    configured: body.configured === true,
    enabledCommandIds: (body.items ?? []).filter((item) => item.enabled).map((item) => item.commandId),
  }
}

/**
 * Set the tenant's enabled set and do not return until a READ agrees.
 *
 * The setting is served through `ModuleConfigService.getValue`, which caches
 * tenant-keyed with a 60 s TTL. The save invalidates that entry, but a test that
 * starts a workflow in the same second as the save is racing an invalidation it
 * has no handle on — and the failure mode is the worst kind: the run takes the
 * OTHER branch and the spec reports a routing bug that does not exist. Reading
 * back until the answer matches turns that race into a bounded wait.
 */
export async function writeCommandSettings(
  request: APIRequestContext,
  scope: Scoped,
  enabledCommandIds: string[],
): Promise<void> {
  const res = await scopedRequest(request, 'PUT', '/api/workflows/command-settings', scope, {
    enabledCommandIds,
  })
  expect(res.status(), 'PUT /api/workflows/command-settings should return 200').toBe(200)

  const expected = new Set(enabledCommandIds)
  const agreed = await poll(async () => {
    const settings = await readCommandSettings(request, scope)
    const actual = new Set(settings.enabledCommandIds)
    if (actual.size !== expected.size) return null
    for (const commandId of expected) if (!actual.has(commandId)) return null
    return settings
  }, 30_000, 1_000)
  expect(
    agreed,
    `the tenant command enablement should read back as ${JSON.stringify(enabledCommandIds)}`,
  ).not.toBeNull()
}

/**
 * How long a change to Settings → Workflows → Commands takes to become true
 * EVERYWHERE.
 *
 * The read-back above only proves the process serving the API sees it. The
 * `UPDATE_ENTITY` activity may execute in the background-worker process, whose
 * `ModuleConfigService` cache is its own in-memory copy on a 60 s TTL that the
 * API's save cannot invalidate across the process boundary. Observed directly:
 * a run started seconds after switching the command OFF still executed it and
 * completed down the SUCCESS route.
 *
 * This is an operator-facing property, not a test artifact — it is written into
 * the runbook — so the fixture waits it out rather than hiding it.
 */
const COMMAND_SETTINGS_SETTLE_MS = Number(process.env.OM_QA_COMMAND_SETTINGS_SETTLE_MS ?? 65_000)

/**
 * Put one command into the requested state, waiting for it to be true
 * everywhere. Returns the tenant's previous enabled set so a suite can restore
 * it. A no-op when the command is already in that state — which is what keeps
 * the suite from paying the settle wait more than once per change.
 */
export async function setCommandEnabled(
  request: APIRequestContext,
  scope: Scoped,
  commandId: string,
  enabled: boolean,
): Promise<string[]> {
  const previous = (await readCommandSettings(request, scope)).enabledCommandIds
  if (previous.includes(commandId) === enabled) return previous
  const next = enabled
    ? [...previous, commandId]
    : previous.filter((candidate) => candidate !== commandId)
  await writeCommandSettings(request, scope, next)
  await new Promise((resolve) => setTimeout(resolve, COMMAND_SETTINGS_SETTLE_MS))
  return previous
}

// --------------------------------------------------------------------------
// Reading what the run produced
// --------------------------------------------------------------------------

export type BriefTask = {
  id: string
  title: string
  interactionType: string
  priority: number | null
}

/**
 * The CRM tasks a briefing produced for one company. `entityId` is
 * `customer_entities.id` — the timeline parent, which is what the ensure-task
 * command writes against and what the company-page widget passes.
 */
export async function listBriefTasks(
  request: APIRequestContext,
  scope: Scoped,
  companyEntityId: string,
): Promise<BriefTask[]> {
  const res = await scopedRequest(
    request,
    'GET',
    `/api/customers/interactions?entityId=${encodeURIComponent(companyEntityId)}&interactionType=task&limit=100`,
    scope,
  )
  expect(res.status(), 'GET /api/customers/interactions should return 200').toBe(200)
  const body = (await res.json()) as { items?: BriefTask[] }
  return body.items ?? []
}

export type BriefNotification = {
  id: string
  type: string
  sourceEntityId: string | null
  groupKey: string | null
}

/** Notifications addressed to the caller, narrowed to one company. */
export async function listBriefNotifications(
  request: APIRequestContext,
  scope: Scoped,
  companyEntityId: string,
): Promise<BriefNotification[]> {
  const res = await scopedRequest(request, 'GET', '/api/notifications?limit=100', scope)
  expect(res.status(), 'GET /api/notifications should return 200').toBe(200)
  const body = (await res.json()) as { items?: BriefNotification[] }
  return (body.items ?? []).filter(
    (item) =>
      (item.type === BRIEF_COMPLETED_EVENT_ID || item.type === BRIEF_FAILED_EVENT_ID) &&
      item.sourceEntityId === companyEntityId,
  )
}

// --------------------------------------------------------------------------
// Driving one briefing up to the parked voice step
// --------------------------------------------------------------------------

/**
 * A company to brief about, and the id that matters.
 *
 * `POST /api/customers/companies` answers `{ id, companyId }` where `id` is the
 * `customer_entities.id` — the TIMELINE PARENT the ensure-task command writes
 * against and the id the header widget passes as `context.companyId`.
 * `companyId` is the `customer_companies.id` and is deliberately ignored here:
 * mixing the two is the single mistake this feature's own tracker had to correct
 * once already (B5's `entityId` note).
 *
 * The shared `createCompanyFixture` is not reused because it sends no
 * organization selection, and the route answers 400 without one for a caller
 * whose token spans several organizations — which every superadmin's does.
 */
async function createBriefingCompany(
  request: APIRequestContext,
  scope: Scoped,
  displayName: string,
): Promise<string> {
  const res = await scopedRequest(request, 'POST', '/api/customers/companies', scope, { displayName })
  expect(res.status(), 'POST /api/customers/companies should return 201').toBe(201)
  const body = (await res.json()) as { id?: string }
  expect(body.id, 'the company create response should carry the customer_entities id').toBeTruthy()
  return body.id as string
}

export type ParkedBriefing = {
  workflowId: string
  definitionId: string
  instanceId: string
  companyEntityId: string
  companyName: string
  externalRunId: string
  callbackUrl: string
}

/**
 * Create a company, publish the shadow definition, start it the way the header
 * button does, and return once the voice step is genuinely PARKED with the
 * connector already started. Returns `null` when the step never parked, so the
 * caller can fail with its own message.
 */
export async function parkBriefingAtVoiceStep(
  request: APIRequestContext,
  scope: Scoped,
  options: { stamp: string; tasks: ShadowTask[] },
): Promise<{ parked: ParkedBriefing | null; cleanup: { definitionId: string | null; instanceId: string | null; companyEntityId: string | null } }> {
  const workflowId = `qa-brief-${options.stamp}`
  const externalRunId = `probe_brief_${randomUUID()}`
  const companyName = `QA Briefing Co ${options.stamp}`
  const cleanup: { definitionId: string | null; instanceId: string | null; companyEntityId: string | null } = {
    definitionId: null,
    instanceId: null,
    companyEntityId: null,
  }

  const companyEntityId = await createBriefingCompany(request, scope, companyName)
  cleanup.companyEntityId = companyEntityId

  const definitionId = await createWorkflowDefinitionFixture(
    request,
    scope.token,
    buildShadowDefinitionPayload({
      workflowId,
      workflowName: `QA Deal Briefing ${options.stamp}`,
      externalRunId,
    }),
  )
  cleanup.definitionId = definitionId

  const startRes = await scopedRequest(request, 'POST', '/api/workflows/instances', scope, {
    workflowId,
    version: 1,
    initialContext: buildShadowInitialContext({ companyEntityId, companyName, tasks: options.tasks }),
    metadata: { entityType: DEAL_BRIEFING_ENTITY_TYPE, entityId: companyEntityId },
  })
  expect(startRes.status(), 'POST /api/workflows/instances should start the briefing').toBe(201)
  const instanceId = ((await startRes.json()) as { data?: { instance?: { id?: string } } }).data?.instance?.id as string
  expect(instanceId, 'the start response should carry the new instance id').toBeTruthy()
  cleanup.instanceId = instanceId

  const parked = await poll(async () => {
    await advanceQueue('workflow-invoke-agent')
    const snapshot = await getWorkflowInstanceSnapshot(request, scope.token, instanceId)
    if (!snapshot || snapshot.status !== 'PAUSED' || snapshot.currentStepId !== 'call_chief') return null
    const starts = await readProbeStarts(request, scope, externalRunId)
    return starts.length > 0 ? starts[0] : null
  })

  if (!parked) return { parked: null, cleanup }

  return {
    parked: {
      workflowId,
      definitionId,
      instanceId,
      companyEntityId,
      companyName,
      externalRunId,
      callbackUrl: parked.callbackUrl,
    },
    cleanup,
  }
}

export async function deleteCompanyIfExists(
  request: APIRequestContext,
  scope: Scoped,
  companyEntityId: string | null,
): Promise<void> {
  if (!companyEntityId) return
  await scopedRequest(request, 'DELETE', '/api/customers/companies', scope, {
    id: companyEntityId,
  }).catch(() => undefined)
}
