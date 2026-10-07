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
  /**
   * The hour the AUTHOR chose, in the recipient's own local time. Null means "as soon as it comes due".
   *
   * Distinct from `optimizeSendTime`, which learns an hour per customer: this one is a decision, and a decision
   * outranks a guess. When both are set the authored hour applies and the learned one is ignored.
   */
  sendHour: z.number().int().min(0).max(23).nullable().default(null),
}).superRefine((policy, ctx) => {
  /**
   * An authored hour inside the campaign's OWN quiet window is refused at save time.
   *
   * At runtime quiet hours dispose and the hour would simply be discarded, so the campaign would work — and do
   * something other than what its own screen says, forever, with nothing to notice. At author time it is always
   * a mistake, and the writer refusing it is the only moment anybody finds out.
   */
  if (policy.sendHour === null || !policy.quietHours) return
  const { startHour, endHour } = policy.quietHours
  const hour = policy.sendHour
  const inside = startHour === endHour
    ? true
    : startHour < endHour
      ? hour >= startHour && hour < endHour
      : hour >= startHour || hour < endHour
  if (!inside) return
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['sendHour'],
    message: 'marketing_automation.validation.sendHourInQuietHours',
  })
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
    /**
     * `withinDays` is a NOTICE PERIOD, and zero is a meaningful one.
     *
     * `positive()` refused it, which made the birthday source's own default — "on the day itself" — impossible
     * to save: an author could only ask for today AND tomorrow. Zero reads the same way for every source that
     * takes it (a quote expiring today, an order delivered today), so the floor is zero and the meaning is
     * unchanged everywhere else. The reorder source is the one where the number is a PERCENTAGE of the cycle
     * rather than a count of days, and its label says so.
     */
    sweepParams: z.object({ withinDays: z.number().int().min(0).optional() }).default({}),
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
/**
 * `updatedAt` is OPTIONAL in the body because the header is the other half of the same channel.
 *
 * The platform's command lock accepts the expected version either as a typed input field or as the
 * `x-om-ext-optimistic-lock-expected-updated-at` header, and it is the header that `buildOptimisticLockHeader`
 * sends. Requiring the body field meant a caller doing it the header way — which is the documented way —
 * got 400 for sending the version correctly, and restoring a revision was one such caller.
 *
 * Optional is not a default. `AGENTS.md` forbids defaulting this to `''`, because the helper falls back to the
 * header only when the value is ABSENT and a present-but-empty string switches the lock off instead of
 * weakening it. Absent means "look at the header"; `''` means "match nothing".
 *
 * A caller that sends neither gets the helper's documented no-op. That is the platform's contract — "strictly
 * additive: when no expected token is present the helper is a no-op" — and respecting `OM_OPTIMISTIC_LOCK=off`
 * is its job rather than this module's to second-guess.
 */
export const campaignGraphSaveSchema = z.object({
  updatedAt: z.string().min(1).optional(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  triggers: z.array(campaignTriggerSchema),
  definition: campaignDefinitionSchema,
})

export const campaignEnabledSchema = z.object({
  updatedAt: z.string().min(1).optional(),
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

/**
 * A content block.
 *
 * `html` is trusted author content and is inserted unescaped, which is why this shape is only ever accepted
 * from a principal holding `campaigns.manage` — the same permission that already lets them write a campaign
 * body. The key is slug-shaped so it cannot smuggle syntax into the `{{block:key}}` reference it appears in.
 */
export const contentBlockCreateSchema = z.object({
  key: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  name: z.string().min(1).max(200),
  html: z.string().max(100_000),
})

export const contentBlockUpdateSchema = z.object({
  updatedAt: z.string().min(1),
  name: z.string().min(1).max(200).optional(),
  html: z.string().max(100_000).optional(),
})

export type ContentBlockCreateInput = z.infer<typeof contentBlockCreateSchema>
export type ContentBlockUpdateInput = z.infer<typeof contentBlockUpdateSchema>

/**
 * An inbound hook. The campaign is fixed at creation: a hook that could be pointed at another campaign
 * would silently redirect an integration somebody else built, from a screen they never see.
 */
export const inboundHookCreateSchema = z.object({
  campaignId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
})

export const inboundHookUpdateSchema = z.object({
  updatedAt: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  /** The only state change a hook has: withdrawn, or back in service. */
  revoked: z.boolean().optional(),
})

/**
 * A segment. The slug is derived on create and immutable afterwards, because saved audiences reference it —
 * renaming it would silently empty every campaign that targeted the segment.
 */
export const segmentCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  expression: campaignDefinitionSchema.shape.audience,
})

export const segmentUpdateSchema = z.object({
  updatedAt: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  expression: campaignDefinitionSchema.shape.audience.optional(),
})

/** Signed, bounded and never zero: a rule that awards nothing is a rule that does nothing. */
const scoreRulePointsSchema = z
  .number()
  .int()
  .min(-10_000)
  .max(10_000)
  .refine((value) => value !== 0, { message: 'points must not be zero' })

/**
 * A score rule. The expression is a segment's; the writer also refuses one that reads `score` or `segments`,
 * which the schema cannot see.
 */
export const scoreRuleCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  expression: campaignDefinitionSchema.shape.audience,
  points: scoreRulePointsSchema,
  isEnabled: z.boolean().optional(),
})

export const scoreRuleUpdateSchema = z.object({
  updatedAt: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  expression: campaignDefinitionSchema.shape.audience.optional(),
  points: scoreRulePointsSchema.optional(),
  isEnabled: z.boolean().optional(),
})
