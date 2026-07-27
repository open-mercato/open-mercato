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

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { getActivityType, registerActivityType } from './activity-registry'
import { calculateWaitDelayMs } from './duration'
import {
  callApiConfigSchema,
  callWebhookConfigSchema,
  emitEventConfigSchema,
  executeFunctionConfigSchema,
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
 * Resolves UPDATE_ENTITY's output contract from the command registry (import
 * is UI-safe: `commands/registry` pulls in only the logger, no ORM). The
 * lookup is sync over already-registered handlers; a missing or not-yet-loaded
 * handler — or one without an `outputSchema` — degrades honestly to 'unknown'.
 */
const resolveCommandOutputContract = (config: unknown): unknown => {
  if (typeof config !== 'object' || config === null) return 'unknown'
  const commandId = (config as Record<string, unknown>).commandId
  if (typeof commandId !== 'string' || commandId.length === 0) return 'unknown'
  return commandRegistry.outputSchemaOf(commandId) ?? 'unknown'
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
  })

  registerActivityType({
    id: 'CALL_WEBHOOK',
    icon: 'Webhook',
    i18nKey: i18nKeyFor('CALL_WEBHOOK'),
    configSchema: callWebhookConfigSchema,
    form: [
      { id: 'url', component: 'text', required: true },
      { id: 'method', component: 'select' },
      { id: 'headers', component: 'keyValue' },
      { id: 'body', component: 'json' },
    ],
    execute: async (config, ctx, deps) => (await loadExecutor()).executeCallWebhook(config, ctx, { signal: deps.signal }),
    async: { capable: true },
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
  })

  registerActivityType({
    id: 'CALL_API',
    icon: 'Globe',
    i18nKey: i18nKeyFor('CALL_API'),
    configSchema: callApiConfigSchema,
    form: [
      { id: 'endpoint', component: 'text', required: true },
      { id: 'method', component: 'select' },
      { id: 'headers', component: 'keyValue' },
      { id: 'body', component: 'json' },
      { id: 'validateTenantMatch', component: 'checkbox' },
    ],
    execute: async (config, ctx, deps) => (await loadExecutor()).executeCallApi(deps.em, config, ctx, deps.container, deps.signal),
    async: { capable: false, reason: 'mintsPerRequestKey' },
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
    mock: (config) => ({ assignments: config.assignments }),
  })
}

registerBuiltinActivityTypes()
