/**
 * Workflows Module - Built-in Activity Types
 *
 * Registers the 7 built-in activity types with the Activity Registry (spec
 * 2026-07-26-workflows-ux-redesign.md section 3.2). Each entry delegates to
 * the existing STABLE executeX handlers in activity-executor.ts — the
 * handlers keep their exported signatures; the registry only adapts them to
 * the uniform (config, ctx, deps) shape.
 */

import { getActivityType, registerActivityType } from './activity-registry'
import {
  calculateWaitDelayMs,
  executeCallApi,
  executeCallWebhook,
  executeEmitEvent,
  executeFunction,
  executeSendEmail,
  executeUpdateEntity,
  executeWait,
} from './activity-executor'
import {
  callApiConfigSchema,
  callWebhookConfigSchema,
  emitEventConfigSchema,
  executeFunctionConfigSchema,
  sendEmailConfigSchema,
  updateEntityConfigSchema,
  waitConfigSchema,
  type WaitConfig,
} from '../data/validators'

const BUILTIN_ACTIVITY_TYPE_IDS = [
  'SEND_EMAIL',
  'EMIT_EVENT',
  'UPDATE_ENTITY',
  'CALL_WEBHOOK',
  'EXECUTE_FUNCTION',
  'WAIT',
  'CALL_API',
] as const

const i18nKeyFor = (id: string): string => `workflows.activities.types.${id}`

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
    execute: (config, ctx, deps) => executeSendEmail(config, ctx, deps.container),
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
    execute: (config, ctx, deps) => executeEmitEvent(config, ctx, deps.container),
    async: { capable: true },
  })

  registerActivityType({
    id: 'UPDATE_ENTITY',
    icon: 'Database',
    i18nKey: i18nKeyFor('UPDATE_ENTITY'),
    configSchema: updateEntityConfigSchema,
    form: [
      { id: 'commandId', component: 'commandId', required: true },
      { id: 'input', component: 'json', required: true },
    ],
    execute: (config, ctx, deps) => executeUpdateEntity(deps.em, config, ctx, deps.container),
    async: { capable: true },
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
    execute: (config, ctx, deps) => executeCallWebhook(config, ctx, { signal: deps.signal }),
    async: { capable: true },
  })

  registerActivityType({
    id: 'EXECUTE_FUNCTION',
    icon: 'FunctionSquare',
    i18nKey: i18nKeyFor('EXECUTE_FUNCTION'),
    configSchema: executeFunctionConfigSchema,
    form: [
      { id: 'functionName', component: 'functionName', required: true },
      { id: 'args', component: 'json' },
    ],
    execute: (config, ctx, deps) => executeFunction(config, ctx, deps.container),
    async: { capable: true },
  })

  registerActivityType<WaitConfig>({
    id: 'WAIT',
    icon: 'Clock',
    i18nKey: i18nKeyFor('WAIT'),
    configSchema: waitConfigSchema,
    form: [
      { id: 'duration', component: 'duration' },
      { id: 'until', component: 'text' },
    ],
    execute: (config) => executeWait(config),
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
    execute: (config, ctx, deps) => executeCallApi(deps.em, config, ctx, deps.container, deps.signal),
    async: { capable: false, reason: 'mintsPerRequestKey' },
  })
}

registerBuiltinActivityTypes()
