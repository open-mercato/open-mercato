import { z } from 'zod'
import { conditionExpressionSchema } from '@open-mercato/core/modules/business_rules/data/validators'
import { SWEEP_SOURCE_IDS } from '../lib/sweep-sources.js'

/**
 * Audience expression, reusing the platform's own condition-expression schema.
 *
 * Deliberately not a second condition language: the same trees the rest of Open Mercato
 * validates, which is what lets the existing condition builder edit them unchanged.
 */
export const audienceSchema = conditionExpressionSchema.nullable()

const canvasPositionSchema = z.object({ x: z.number(), y: z.number() })

export const campaignCanvasSchema = z.object({
  viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }).optional(),
  nodePositions: z.record(z.string(), canvasPositionSchema).optional(),
})

/**
 * One authored step. `params` stays opaque here — the step handler's own schema validates it,
 * which is what keeps a third-party step type valid without this file knowing about it.
 */
export const campaignStepSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
})

export const frequencyCapSchema = z.object({
  maxMessages: z.number().int().positive(),
  windowHours: z.number().int().positive(),
})

export const quietHoursSchema = z.object({
  startHour: z.number().int().min(0).max(23),
  endHour: z.number().int().min(0).max(23),
})

export const campaignSendPolicySchema = z.object({
  frequencyCap: frequencyCapSchema.nullable().default(null),
  quietHours: quietHoursSchema.nullable().default(null),
  /** Defer a send to the hour this customer usually opens email. Off unless asked for. */
  optimizeSendTime: z.boolean().default(false),
})

export const campaignDefinitionSchema = z.object({
  version: z.literal(1),
  audience: audienceSchema.default(null),
  steps: z.array(campaignStepSchema).default([]),
  canvas: campaignCanvasSchema.optional(),
  sendPolicy: campaignSendPolicySchema.optional(),
})

/** An event trigger reacts to something; a scheduled trigger sweeps the audience periodically. */
export const campaignTriggerSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('event'),
    eventId: z.string().min(1),
  }),
  z.object({
    kind: z.literal('schedule'),
    /** Interval such as `30m`, `6h`, `1d`. Validated on save; see `lib/sweep-interval.ts`. */
    scheduleValue: z.string().min(1),
    /**
     * Without a re-entry window a sweep re-enrols the same subject on every tick, because the
     * audience it matches ("has not ordered in 90 days") stays true. Null means enrol once ever.
     */
    reentryAfterDays: z.number().int().positive().nullable().default(null),
    /** What the sweep iterates over; the ids come from the source registry, not a second list. */
    sweepSource: z.enum(SWEEP_SOURCE_IDS).default('customers'),
    sweepParams: z.object({ withinDays: z.number().int().positive().optional() }).default({}),
  }),
])

/**
 * The canvas save payload.
 *
 * `updatedAt` carries the optimistic lock: two people editing the same campaign must collide
 * rather than silently overwrite, and a campaign graph is exactly the kind of document two
 * people edit at once.
 */
/**
 * `isEnabled` is deliberately NOT here. Taking a campaign live is what starts messaging real
 * customers, so it is its own endpoint behind `marketing_automation.campaigns.publish` rather than
 * a field on a save that only needs `campaigns.manage`.
 */
export const campaignGraphSaveSchema = z.object({
  updatedAt: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  triggers: z.array(campaignTriggerSchema),
  definition: campaignDefinitionSchema,
})

export const campaignEnabledSchema = z.object({
  updatedAt: z.string().min(1),
  isEnabled: z.boolean(),
})

export type Audience = z.infer<typeof audienceSchema>
export type CampaignCanvasInput = z.infer<typeof campaignCanvasSchema>
export type CampaignStepInput = z.infer<typeof campaignStepSchema>
export type CampaignDefinitionInput = z.infer<typeof campaignDefinitionSchema>
export type CampaignTriggerInput = z.infer<typeof campaignTriggerSchema>
export type CampaignSendPolicyInput = z.infer<typeof campaignSendPolicySchema>
export type CampaignGraphSaveInput = z.infer<typeof campaignGraphSaveSchema>
export type CampaignEnabledInput = z.infer<typeof campaignEnabledSchema>
