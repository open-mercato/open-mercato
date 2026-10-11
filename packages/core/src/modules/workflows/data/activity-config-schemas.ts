import { z } from 'zod'
import { parseDuration } from '../lib/duration'
import {
  taskDeadlineSchema,
  taskPrioritySchema,
  taskReminderSchema,
} from './task-primitives'

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

/**
 * What happens when nobody dispositions a proposal before its deadline (§7.5).
 *
 * The vocabulary is deliberately NARROWER than `taskOnBreachSchema`: it has no
 * `route` action, and no verdict of any kind. A breached deadline ESCALATES —
 * it never decides. Auto-rejecting (or auto-approving, or routing the run past
 * a proposal nobody answered) would be a disposition reached without a human,
 * which is the boundary `agent_orchestrator/AGENTS.md` guards, so the missing
 * arm is the feature rather than an omission. The proposal stays `pending`
 * until a person acts on it.
 */
export const agentReviewOnBreachSchema = z.object({
  action: z.enum(['notify', 'reassign', 'attention']),
  reassignTo: z.string().optional(),
})
export type AgentReviewOnBreach = z.infer<typeof agentReviewOnBreachSchema>

/**
 * The Invoke Agent node's Review section (§7.5) — who reviews a proposal this
 * step raises, and by when.
 *
 * Speaks the SAME vocabulary as the Task inspector's Who (§6.1.3) and When
 * (§6.1.4) groups, because the thing being authored IS a task: the implicit
 * disposition task `dispositionService` raises when the confidence gate routes
 * to a human. Every key is optional and additive — a step declaring none of
 * them raises exactly the task it raised before.
 */
export const agentReviewConfigSchema = z.object({
  assignedTo: z.string().optional(),
  assignedToRoles: z.array(z.string()).optional(),
  priority: taskPrioritySchema.optional(),
  deadline: taskDeadlineSchema.optional(),
  reminders: z.array(taskReminderSchema).optional(),
  onBreach: agentReviewOnBreachSchema.optional(),
})
export type AgentReviewConfig = z.infer<typeof agentReviewConfigSchema>

// INVOKE_AGENT activity configuration — runs a callable agent (area 02a) and
// dispositions any proposal. `onResult` is carried verbatim to the
// agent_orchestrator disposition service.
export const invokeAgentConfigSchema = z.object({
  agentId: z.string().min(1),
  input: z.record(z.string(), z.any()).default({}),
  onResult: z.union([
    z.object({
      autoApproveThreshold: z.number().min(0).max(1),
      /**
       * Minimum separation the leading option must hold over the runner-up before a
       * threshold-clearing proposal auto-approves. A near-tie is the agent saying it
       * cannot tell its top two apart; reading that as certainty is how an
       * auto-approved wrong answer happens.
       *
       * Defaults to `0`, which is today's rule EXACTLY. A non-zero default would
       * change behaviour for every existing config without anyone asking for it, so
       * a margin is opt-in and the authoring UI recommends one.
       */
      autoApproveMargin: z.number().min(0).max(1).default(0),
    }),
    z.object({ alwaysAsk: z.literal(true) }),
  ]),
  // Optional routing of the agent result into workflow context. Keys are the
  // target context paths; values are plain dot-paths into the normalized agent
  // result envelope (kind / disposition / proposalId / proposalPayload / data).
  // Mirrors SUB_WORKFLOW's outputMapping. When omitted, the engine writes the
  // legacy fixed keys (disposition / agentProposalId / proposalPayload).
  outputMapping: z.record(z.string(), z.string()).optional(),
  // Optional business-record descriptor ("what this process is about"), static
  // or {{context.*}}-interpolated like the rest of the config. Forwarded opaquely
  // to the agent_orchestrator bridge (additive; the enterprise module validates
  // the shape) so its process projection can render a claim-centric caseload.
  subject: z.record(z.string(), z.any()).optional(),
  // The Review section (spec 7.5) — who reviews the proposal this step raises,
  // and by when. A sibling key rather than a member of the `onResult` union:
  // `alwaysAsk` and a threshold can BOTH end in a human review, so the two
  // decisions are orthogonal.
  review: agentReviewConfigSchema.optional(),
})
export type InvokeAgentConfig = z.infer<typeof invokeAgentConfigSchema>

export const setVariableAssignmentSchema = z.looseObject({
  path: z.string().min(1, 'SET_VARIABLE assignment requires "path"'),
  value: z.unknown(),
})

export const setVariableConfigSchema = z.looseObject({
  assignments: z
    .array(setVariableAssignmentSchema)
    .min(1, 'SET_VARIABLE requires at least one assignment'),
})
export type SetVariableConfig = z.infer<typeof setVariableConfigSchema>

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
