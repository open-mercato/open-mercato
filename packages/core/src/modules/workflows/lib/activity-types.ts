/**
 * Workflows Module - Built-in Activity Types
 *
 * Registers the built-in activity types with the Activity Registry (spec
 * 2026-07-26-workflows-ux-redesign.md section 3.2). Each entry delegates to
 * the existing STABLE executeX handlers in activity-executor.ts — the
 * handlers keep their exported signatures; the registry only adapts them to
 * the uniform (config, ctx, deps) shape.
 *
 * The executor is reached through a runtime binding seam instead of any
 * import: this module sits on the registry bootstrap chain that validators.ts
 * and the visual editor import, and even a dynamic import('./activity-executor')
 * gets chunked into the client bundle by Turbopack, dragging queue/bullmq and
 * node builtins into contexts that forbid them. activity-executor.ts binds its
 * own handlers via bindActivityExecutor() when it loads on the server, so the
 * closures below resolve them without the bundler ever seeing an edge.
 * Registration itself needs only the schemas, form specs, and metadata. WAIT
 * is the exception: its pure delay executes inline so the timer is scheduled
 * synchronously (matching executeWait's observable behavior under fake
 * timers).
 */

import { z, type ZodTypeAny } from 'zod'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { getActivityType, registerActivityType } from './activity-registry'
import { calculateWaitDelayMs } from './duration'
import {
  callApiConfigSchema,
  callWebhookConfigSchema,
  emitEventConfigSchema,
  executeFunctionConfigSchema,
  invokeAgentConfigSchema,
  sendEmailConfigSchema,
  setVariableConfigSchema,
  updateEntityConfigSchema,
  waitConfigSchema,
  type SetVariableConfig,
  type WaitConfig,
} from '../data/activity-config-schemas'

const BUILTIN_ACTIVITY_TYPE_IDS = [
  'SEND_EMAIL',
  'EMIT_EVENT',
  'UPDATE_ENTITY',
  'CALL_WEBHOOK',
  'EXECUTE_FUNCTION',
  'WAIT',
  'CALL_API',
  'SET_VARIABLE',
  'INVOKE_AGENT',
] as const

const i18nKeyFor = (id: string): string => `workflows.activities.types.${id}`

export type ActivityExecutorBinding = Pick<
  typeof import('./activity-executor'),
  | 'executeSendEmail'
  | 'executeEmitEvent'
  | 'executeUpdateEntity'
  | 'executeCallWebhook'
  | 'executeFunction'
  | 'executeCallApi'
  | 'executeSetVariable'
  | 'executeInvokeAgent'
>

let boundExecutor: ActivityExecutorBinding | null = null

export function bindActivityExecutor(executor: ActivityExecutorBinding): void {
  boundExecutor = executor
}

const loadExecutor = async (): Promise<ActivityExecutorBinding> => {
  if (!boundExecutor) {
    throw new Error('[internal] Activity executor is not bound in this runtime')
  }
  return boundExecutor
}

/**
 * UPDATE_ENTITY does NOT put the command's return value into context — it puts
 * `executeUpdateEntity`'s envelope there (`{ executed, commandId, result,
 * logEntryId }`, activity-executor.ts), and the command's own output sits under
 * `result`. Both merge paths carry that envelope verbatim: the sync transition
 * route namespaces it under `activityName || activityType`, the async route
 * under `${activityId}_result`. So the contract has to be the envelope, exactly
 * as INVOKE_AGENT's is — a contract naming the command's bare keys advertises
 * `<activity>.dealId` for a context that only ever holds
 * `<activity>.result.dealId`.
 */
const updateEntityEnvelopeShape = {
  executed: z.boolean(),
  commandId: z.string(),
  logEntryId: z.string(),
}

/**
 * Resolves UPDATE_ENTITY's output contract from the command registry (import
 * is UI-safe: `commands/registry` pulls in only the logger, no ORM). The
 * lookup is sync over already-registered handlers; a missing or not-yet-loaded
 * handler — or one without an `outputSchema` — degrades honestly to 'unknown',
 * which prefix-resolves every ref under the activity key and so stays exactly
 * as permissive as it was before the envelope was modelled.
 */
const resolveCommandOutputContract = (config: unknown): ZodTypeAny | 'unknown' => {
  if (typeof config !== 'object' || config === null) return 'unknown'
  const commandId = (config as Record<string, unknown>).commandId
  if (typeof commandId !== 'string' || commandId.length === 0) return 'unknown'
  const outputSchema = commandRegistry.outputSchemaOf(commandId)
  if (!outputSchema) return 'unknown'
  return z.object({ ...updateEntityEnvelopeShape, result: outputSchema })
}

/**
 * CALL_API's output contract resolves the picked endpoint's declared response
 * schema from the in-process endpoint catalog (lib/endpoint-catalog.ts).
 * That helper is server-only, so — like the executor — it is reached through
 * a runtime binding seam: server-output-contract.ts binds the resolver when
 * it loads. Unbound runtimes (the browser), unmatched or free-text endpoints,
 * and templated methods all degrade honestly to 'unknown'.
 */
export type CallApiResponseSchemaResolver = (endpoint: string, method: string) => ZodTypeAny | 'unknown'

let boundCallApiResponseSchemaResolver: CallApiResponseSchemaResolver | null = null

export function bindCallApiResponseSchemaResolver(resolver: CallApiResponseSchemaResolver): void {
  boundCallApiResponseSchemaResolver = resolver
}

const resolveCallApiOutputContract = (config: unknown): ZodTypeAny | 'unknown' => {
  if (!boundCallApiResponseSchemaResolver) return 'unknown'
  if (typeof config !== 'object' || config === null) return 'unknown'
  const record = config as Record<string, unknown>
  const endpoint = record.endpoint
  if (typeof endpoint !== 'string' || endpoint.length === 0) return 'unknown'
  const rawMethod = record.method
  if (rawMethod !== undefined && typeof rawMethod !== 'string') return 'unknown'
  const method = typeof rawMethod === 'string' && rawMethod.length > 0 ? rawMethod : 'GET'
  if (method.includes('{{')) return 'unknown'
  return boundCallApiResponseSchemaResolver(endpoint, method)
}

/**
 * INVOKE_AGENT's output contract describes the normalized agent-result envelope
 * that `mapAgentResultToContext` reads its `outputMapping` source paths from.
 * The envelope keys are the platform's own contract; the OUTCOME shape under
 * `data` (informative agents) or `proposalPayload` (actionable agents) belongs
 * to the selected agent and lives in the OPTIONAL agent_orchestrator peer, so it
 * arrives through a runtime binding seam — core never imports enterprise.
 * server-output-contract.ts binds a resolver backed by the peer's DI bridge;
 * unbound runtimes (the browser), a missing peer, a templated or unknown agent
 * id, and agents without a declared OUTCOME all degrade honestly to 'unknown'.
 */
export type AgentOutcomeContract = {
  resultKind: 'informative' | 'actionable'
  schema: ZodTypeAny
}

export type AgentOutcomeSchemaResolver = (agentId: string) => AgentOutcomeContract | 'unknown'

let boundAgentOutcomeSchemaResolver: AgentOutcomeSchemaResolver | null = null

export function bindAgentOutcomeSchemaResolver(resolver: AgentOutcomeSchemaResolver): void {
  boundAgentOutcomeSchemaResolver = resolver
}

const agentEnvelopeShape = {
  kind: z.string(),
  disposition: z.string(),
  agentId: z.string(),
  proposalId: z.string(),
}

const resolveInvokeAgentOutputContract = (config: unknown): ZodTypeAny | 'unknown' => {
  if (!boundAgentOutcomeSchemaResolver) return 'unknown'
  if (typeof config !== 'object' || config === null) return 'unknown'
  const agentId = (config as Record<string, unknown>).agentId
  if (typeof agentId !== 'string' || agentId.length === 0 || agentId.includes('{{')) return 'unknown'
  const outcome = boundAgentOutcomeSchemaResolver(agentId)
  if (outcome === 'unknown') return 'unknown'
  const outcomeKey = outcome.resultKind === 'informative' ? 'data' : 'proposalPayload'
  return z.object({ ...agentEnvelopeShape, [outcomeKey]: outcome.schema })
}

/**
 * Would-do mocks receive raw (possibly still-templated) config, so they read
 * keys defensively instead of trusting a schema parse: callers like the
 * test-step route interpolate before invoking, but nothing guarantees it.
 */
const asConfigRecord = (config: unknown): Record<string, unknown> =>
  typeof config === 'object' && config !== null ? (config as Record<string, unknown>) : {}

/**
 * INVOKE_AGENT's would-do payload (spec section 8.2).
 *
 * It names the agent and the disposition the step would REQUEST — never a
 * fabricated outcome. A real run's disposition is decided by the model's
 * confidence against `onResult.autoApproveThreshold`, and a simulation has no
 * confidence, so the honest answer is the one `dispositionService` already
 * gives for a missing confidence: fail closed to human review. The envelope
 * deliberately does NOT reuse the runtime `kind` vocabulary
 * (`auto_approved` / `informative` / `user_task`) so nothing downstream can
 * mistake a simulation for a disposition that actually happened.
 */
const buildInvokeAgentWouldDo = (config: unknown): Record<string, unknown> => {
  const record = asConfigRecord(config)
  const onResult = asConfigRecord(record.onResult)
  const threshold = typeof onResult.autoApproveThreshold === 'number'
    ? onResult.autoApproveThreshold
    : null
  return {
    simulated: true,
    invoked: false,
    kind: 'would_invoke',
    wouldInvokeAgent: typeof record.agentId === 'string' ? record.agentId : null,
    wouldRequestDisposition: 'human_review',
    reason: onResult.alwaysAsk === true ? 'alwaysAsk' : 'noConfidenceInSimulation',
    autoApproveThreshold: threshold,
  }
}

export function registerBuiltinActivityTypes(): void {
  if (BUILTIN_ACTIVITY_TYPE_IDS.every((id) => getActivityType(id) != null)) return

  registerActivityType({
    id: 'SEND_EMAIL',
    icon: 'Mail',
    i18nKey: i18nKeyFor('SEND_EMAIL'),
    configSchema: sendEmailConfigSchema,
    form: [
      { id: 'to', component: 'text', required: true },
      { id: 'subject', component: 'text', required: true },
      { id: 'template', component: 'text' },
      { id: 'body', component: 'textarea' },
    ],
    execute: async (config, ctx, deps) => (await loadExecutor()).executeSendEmail(config, ctx, deps.container),
    async: { capable: true },
    mock: (config) => {
      const record = asConfigRecord(config)
      return { sent: false, simulated: true, wouldSendTo: record.to, subject: record.subject }
    },
  })

  registerActivityType({
    id: 'EMIT_EVENT',
    icon: 'Radio',
    i18nKey: i18nKeyFor('EMIT_EVENT'),
    configSchema: emitEventConfigSchema,
    form: [
      { id: 'eventName', component: 'eventName', required: true },
      { id: 'payload', component: 'json' },
    ],
    execute: async (config, ctx, deps) => (await loadExecutor()).executeEmitEvent(config, ctx, deps.container),
    async: { capable: true },
    mock: (config) => {
      const record = asConfigRecord(config)
      return { emitted: false, simulated: true, eventName: record.eventName }
    },
  })

  registerActivityType({
    id: 'UPDATE_ENTITY',
    icon: 'Database',
    i18nKey: i18nKeyFor('UPDATE_ENTITY'),
    configSchema: updateEntityConfigSchema,
    form: [
      {
        id: 'commandId',
        component: 'commandId',
        required: true,
        descriptionKey: 'workflows.activityConfig.UPDATE_ENTITY.commandIdHint',
      },
      { id: 'input', component: 'json', required: true },
      { id: 'statusDictionary', component: 'text' },
    ],
    execute: async (config, ctx, deps) => (await loadExecutor()).executeUpdateEntity(deps.em, config, ctx, deps.container),
    async: { capable: true },
    outputContract: resolveCommandOutputContract,
    mock: (config) => {
      const record = asConfigRecord(config)
      return { executed: false, simulated: true, commandId: record.commandId }
    },
  })

  registerActivityType({
    id: 'CALL_WEBHOOK',
    icon: 'Webhook',
    i18nKey: i18nKeyFor('CALL_WEBHOOK'),
    configSchema: callWebhookConfigSchema,
    form: [
      {
        id: 'url',
        component: 'text',
        required: true,
        descriptionKey: 'workflows.activityConfig.CALL_WEBHOOK.urlHint',
      },
      { id: 'method', component: 'select' },
      { id: 'headers', component: 'keyValue' },
      { id: 'body', component: 'json' },
    ],
    execute: async (config, ctx, deps) => (await loadExecutor()).executeCallWebhook(config, ctx, { signal: deps.signal }),
    async: { capable: true },
    mock: (config) => {
      const record = asConfigRecord(config)
      return { simulated: true, wouldCall: { url: record.url, method: record.method ?? 'POST' } }
    },
  })

  registerActivityType({
    id: 'EXECUTE_FUNCTION',
    icon: 'FunctionSquare',
    i18nKey: i18nKeyFor('EXECUTE_FUNCTION'),
    configSchema: executeFunctionConfigSchema,
    form: [
      {
        id: 'functionName',
        component: 'functionName',
        required: true,
        descriptionKey: 'workflows.activityConfig.EXECUTE_FUNCTION.functionNameHint',
      },
      { id: 'args', component: 'json' },
    ],
    execute: async (config, ctx, deps) => (await loadExecutor()).executeFunction(config, ctx, deps.container),
    async: { capable: true },
    mock: 'refuse',
  })

  registerActivityType<WaitConfig>({
    id: 'WAIT',
    icon: 'Clock',
    i18nKey: i18nKeyFor('WAIT'),
    configSchema: waitConfigSchema,
    form: [
      { id: 'duration', component: 'duration' },
      { id: 'until', component: 'datetime' },
    ],
    execute: (config) => {
      const durationMs = calculateWaitDelayMs(config)
      return new Promise((resolve) => {
        setTimeout(() => resolve({ waited: true, durationMs }), durationMs)
      })
    },
    executeAsync: async () => ({ waited: true, async: true }),
    async: { capable: true },
    enqueueDelayMs: (config) =>
      config.duration || config.until ? calculateWaitDelayMs(config) : null,
    mock: () => ({ waited: true, simulated: true }),
  })

  registerActivityType({
    id: 'CALL_API',
    icon: 'Globe',
    i18nKey: i18nKeyFor('CALL_API'),
    configSchema: callApiConfigSchema,
    form: [
      {
        id: 'endpoint',
        component: 'endpoint',
        required: true,
        descriptionKey: 'workflows.activityConfig.CALL_API.endpointHint',
      },
      { id: 'method', component: 'select' },
      { id: 'headers', component: 'keyValue' },
      { id: 'body', component: 'json' },
      { id: 'validateTenantMatch', component: 'checkbox' },
    ],
    execute: async (config, ctx, deps) => (await loadExecutor()).executeCallApi(deps.em, config, ctx, deps.container, deps.signal),
    async: { capable: false, reason: 'mintsPerRequestKey' },
    outputContract: resolveCallApiOutputContract,
    mock: 'refuse',
  })

  registerActivityType<SetVariableConfig>({
    id: 'SET_VARIABLE',
    icon: 'Variable',
    i18nKey: i18nKeyFor('SET_VARIABLE'),
    configSchema: setVariableConfigSchema,
    form: [
      {
        id: 'assignments',
        component: 'assignments',
        required: true,
        descriptionKey: 'workflows.activityConfig.SET_VARIABLE.assignmentsHint',
      },
    ],
    execute: async (config, ctx) => (await loadExecutor()).executeSetVariable(config, ctx),
    async: { capable: false, reason: 'asyncResumeMergeDoesNotApplyAssignments' },
    mock: (config) => ({ simulated: true, assignments: config.assignments }),
  })

  registerActivityType({
    id: 'INVOKE_AGENT',
    icon: 'Bot',
    i18nKey: i18nKeyFor('INVOKE_AGENT'),
    configSchema: invokeAgentConfigSchema,
    form: [
      { id: 'agentId', component: 'text', required: true },
      { id: 'input', component: 'json' },
      { id: 'onResult', component: 'json', required: true },
      { id: 'outputMapping', component: 'json' },
    ],
    // SYNC-dispatched by design: execute() enqueues an 'invoke_agent' job onto
    // the dedicated workflow-invoke-agent queue and returns a `__park` marker so
    // the step handler PAUSES the instance on INVOKE_AGENT_SIGNAL_NAME. The job
    // rides its own queue and resumes via sendSignal — not the generic
    // resumeWorkflowAfterActivities path — so the activity is not async-capable
    // in the registry's sense.
    execute: async (config, ctx, deps) => (await loadExecutor()).executeInvokeAgent(config, ctx, deps.container),
    async: { capable: false, reason: 'parksOnDedicatedQueue' },
    mock: buildInvokeAgentWouldDo,
    outputContract: resolveInvokeAgentOutputContract,
  })
}

registerBuiltinActivityTypes()
