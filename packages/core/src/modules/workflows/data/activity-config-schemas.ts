import { z } from 'zod'
import { parseDuration } from '../lib/duration'

/**
 * Per-type activity config schemas for the Activity Registry (spec
 * 2026-07-26-workflows-ux-redesign.md section 3.2).
 *
 * Lives in its own module (not validators.ts) so the registry bootstrap chain
 * (activity-registry-bootstrap → activity-types → these schemas) never loops
 * back into validators.ts, which itself imports the bootstrap to build the
 * registry-driven activityTypeSchema enum. validators.ts re-exports
 * everything here, so the public import surface is unchanged.
 *
 * Loose objects: configs in the wild carry extra keys, and every field
 * tolerates {{interpolation}} template strings resolved at run time.
 */

// Variable interpolation tokens (e.g., {{context.timeout}}) are resolved at
// run time, so we must skip strict syntax checks on them at save time.
const containsTemplate = (value: string) => value.includes('{{')

export function isValidDurationString(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0) return false
  if (containsTemplate(value)) return true
  try {
    const ms = parseDuration(value)
    return Number.isFinite(ms) && ms > 0
  } catch {
    return false
  }
}

export function isValidIsoDateString(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0) return false
  if (containsTemplate(value)) return true
  const d = new Date(value)
  return !Number.isNaN(d.getTime())
}

export function isFutureIsoDateString(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0) return false
  if (containsTemplate(value)) return true
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return false
  return d.getTime() > Date.now()
}

export const DURATION_ERROR = 'Invalid duration. Use ISO 8601 (e.g., PT5M, PT1H, P1D) or simple format (5m, 1h, 3d)'
export const UNTIL_ERROR = 'Invalid "until". Provide an ISO 8601 datetime string'
export const UNTIL_PAST_ERROR = '"until" must be a future datetime'

// Fields that are semantically enums/numbers/booleans still accept
// {{interpolation}} template strings resolved at run time.
const templateStringSchema = z
  .string()
  .refine(containsTemplate, 'Must be a {{template}} expression')

// CALL_API activity configuration
export const callApiConfigSchema = z.object({
  endpoint: z.string().min(1, 'API endpoint is required'),
  method: z
    .union([z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']), templateStringSchema])
    .default('GET'),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.any().optional(),
  validateTenantMatch: z.union([z.boolean(), templateStringSchema]).default(true).optional(),
  timeout: z.union([z.number().int().positive(), templateStringSchema]).optional(),
})

export const callWebhookConfigSchema = z.object({
  url: z.string().min(1, 'Webhook URL is required'),
  method: z
    .union([z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']), templateStringSchema])
    .default('POST'),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.any().optional(),
})
export type CallWebhookConfig = z.infer<typeof callWebhookConfigSchema>

export const sendEmailConfigSchema = z.looseObject({
  to: z.string().min(1, 'SEND_EMAIL requires "to"'),
  subject: z.string().min(1, 'SEND_EMAIL requires "subject"'),
  template: z.string().optional(),
  templateData: z.record(z.string(), z.any()).optional(),
  body: z.any().optional(),
})
export type SendEmailConfig = z.infer<typeof sendEmailConfigSchema>

export const emitEventConfigSchema = z.looseObject({
  eventName: z.string().min(1, 'EMIT_EVENT requires "eventName"'),
  payload: z.record(z.string(), z.any()).optional(),
})
export type EmitEventConfig = z.infer<typeof emitEventConfigSchema>

export const updateEntityConfigSchema = z.looseObject({
  commandId: z.string().min(1, 'UPDATE_ENTITY requires "commandId"'),
  input: z.record(z.string(), z.any()),
  statusDictionary: z.string().optional(),
})
export type UpdateEntityConfig = z.infer<typeof updateEntityConfigSchema>

export const executeFunctionConfigSchema = z.looseObject({
  functionName: z.string().min(1, 'EXECUTE_FUNCTION requires "functionName"'),
  args: z.record(z.string(), z.any()).optional(),
})
export type ExecuteFunctionConfig = z.infer<typeof executeFunctionConfigSchema>

export const waitConfigSchema = z.looseObject({
  duration: z.string().optional(),
  until: z.string().optional(),
}).superRefine((config, ctx) => {
  const hasDuration = config.duration != null && config.duration !== ''
  const hasUntil = config.until != null && config.until !== ''
  if (!hasDuration && !hasUntil) {
    ctx.addIssue({
      code: 'custom',
      path: [],
      message: 'WAIT activity requires "duration" or "until"',
    })
    return
  }
  if (hasDuration && hasUntil) {
    ctx.addIssue({
      code: 'custom',
      path: [],
      message: 'WAIT activity accepts "duration" OR "until", not both',
    })
    return
  }
  if (hasDuration && !isValidDurationString(config.duration)) {
    ctx.addIssue({
      code: 'custom',
      path: ['duration'],
      message: DURATION_ERROR,
    })
  }
  if (hasUntil) {
    if (!isValidIsoDateString(config.until)) {
      ctx.addIssue({
        code: 'custom',
        path: ['until'],
        message: UNTIL_ERROR,
      })
    } else if (!isFutureIsoDateString(config.until)) {
      ctx.addIssue({
        code: 'custom',
        path: ['until'],
        message: UNTIL_PAST_ERROR,
      })
    }
  }
})
export type WaitConfig = z.infer<typeof waitConfigSchema>
