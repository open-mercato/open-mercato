import { z } from 'zod'
import { getDeclaredEvents } from '@open-mercato/shared/modules/events'

const uuid = () => z.string().uuid()
const emptyStringToNull = (value: unknown) => (value === '' ? null : value)
const optionalText = (max: number) =>
  z.preprocess(emptyStringToNull, z.string().trim().max(max).nullable().optional())

export const slaTargetsSchema = z.record(z.string(), z.object({
  response_minutes: z.number().int(),
  resolution_minutes: z.number().int(),
  at_risk_pct: z.number().int().min(1).max(99).default(80),
}))

export const updateCadenceSchema = z.record(z.string(), z.object({
  updateMinutes: z.number().int().positive(),
}))

export const triggerConditionSchema = z.object({
  path: z.string().trim().min(1).max(240),
  equals: z.union([z.string(), z.number(), z.boolean()]),
})

function isExcludedDeclaredEvent(eventId: string): boolean {
  const declaredEvent = getDeclaredEvents().find((event) => event.id === eventId)
  return declaredEvent?.excludeFromTriggers === true
}

const triggerEventIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .refine((eventId) => !eventId.startsWith('incidents.'))
  .refine((eventId) => !isExcludedDeclaredEvent(eventId))

export const incidentCreateSchema = z.object({
  organizationId: uuid(),
  tenantId: uuid(),
  title: z.string().trim().min(1).max(200),
  description: optionalText(8000),
  incidentTypeId: uuid().nullable().optional(),
  severityId: uuid(),
  priority: z.string().trim().max(50).nullable().optional(),
  ownerUserId: uuid().nullable().optional(),
  owningTeamId: uuid().nullable().optional(),
  escalationPolicyId: uuid().nullable().optional(),
  customerImpactSummary: optionalText(8000),
  sourceEventRef: z.string().trim().min(1).max(300).nullable().optional(),
})

export type IncidentCreateInput = z.infer<typeof incidentCreateSchema>

export const incidentUpdateSchema = incidentCreateSchema.partial().extend({
  id: uuid(),
})

export type IncidentUpdateInput = z.infer<typeof incidentUpdateSchema>

export const severityCreateSchema = z.object({
  organizationId: uuid(),
  tenantId: uuid(),
  key: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(120),
  rank: z.coerce.number().int(),
  colorToken: z.string().trim().min(1).max(80),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
})

export type IncidentSeverityCreateInput = z.infer<typeof severityCreateSchema>

export const severityUpdateSchema = severityCreateSchema.partial().extend({ id: uuid() })

export type IncidentSeverityUpdateInput = z.infer<typeof severityUpdateSchema>

export const escalationStepSchema = z.object({
  delayMinutes: z.coerce.number().int().min(0),
  targets: z.array(z.object({ type: z.enum(['user', 'team', 'role']), id: uuid() })).min(1),
  notifyStrategy: z.enum(['all']).optional().default('all'),
})

export const escalationPolicyStepsSchema = z.array(escalationStepSchema).min(1)

export const escalationPolicyCreateSchema = z.object({
  organizationId: uuid().optional(),
  tenantId: uuid().optional(),
  key: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(200),
  steps: escalationPolicyStepsSchema,
  repeatCount: z.coerce.number().int().min(0).max(20).optional().default(0),
  isDefault: z.coerce.boolean().optional().default(false),
  isActive: z.coerce.boolean().optional().default(true),
})

export const escalationPolicyUpdateSchema = escalationPolicyCreateSchema.partial().extend({
  id: uuid(),
  organizationId: uuid().optional(),
  tenantId: uuid().optional(),
})

export type IncidentEscalationPolicyCreateInput = z.infer<typeof escalationPolicyCreateSchema>

export type IncidentEscalationPolicyUpdateInput = z.infer<typeof escalationPolicyUpdateSchema>

export const typeCreateSchema = z.object({
  organizationId: uuid(),
  tenantId: uuid(),
  key: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(120),
  defaultSeverityId: uuid().nullable().optional(),
  defaultEscalationPolicyId: uuid().nullable().optional(),
  defaultRoleIds: z.array(uuid()).nullable().optional(),
  requiredFieldsOnResolve: z.array(z.string().trim().min(1).max(120)).nullable().optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
})

export type IncidentTypeCreateInput = z.infer<typeof typeCreateSchema>

export const typeUpdateSchema = typeCreateSchema.partial().extend({ id: uuid() })

export type IncidentTypeUpdateInput = z.infer<typeof typeUpdateSchema>

export const roleCreateSchema = z.object({
  organizationId: uuid(),
  tenantId: uuid(),
  key: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(120),
  isActive: z.boolean().optional(),
})

export type IncidentRoleCreateInput = z.infer<typeof roleCreateSchema>

export const roleUpdateSchema = roleCreateSchema.partial().extend({ id: uuid() })

export type IncidentRoleUpdateInput = z.infer<typeof roleUpdateSchema>

const settingsUpdateBaseSchema = z.object({
  id: uuid().optional(),
  organizationId: uuid().optional(),
  tenantId: uuid().optional(),
  numberFormat: z.string().trim().min(1).max(120).optional(),
  ackTimeoutMinutes: z.coerce.number().int().nullable().optional(),
  escalationTimeoutMinutes: z.coerce.number().int().nullable().optional(),
  defaultEscalationPolicyId: uuid().nullable().optional(),
  slaTargets: slaTargetsSchema.nullable().optional(),
  updateCadence: updateCadenceSchema.nullable().optional(),
})

export const settingsUpdateSchema = settingsUpdateBaseSchema

export type IncidentSettingsUpdateInput = z.infer<typeof settingsUpdateSchema>

export const triggerCreateSchema = z.object({
  organizationId: uuid(),
  tenantId: uuid(),
  eventId: triggerEventIdSchema,
  isEnabled: z.boolean().optional(),
  severityKey: optionalText(80),
  typeKey: optionalText(80),
  escalationPolicyId: uuid().nullable().optional(),
  conditions: z.array(triggerConditionSchema).nullable().optional(),
})

export type IncidentTriggerCreateInput = z.infer<typeof triggerCreateSchema>

export const triggerUpdateSchema = triggerCreateSchema.partial().extend({ id: uuid() })

export type IncidentTriggerUpdateInput = z.infer<typeof triggerUpdateSchema>

export const impactTargetTypeSchema = z.enum([
  'customer_person',
  'customer_company',
  'customer_account',
  'sales_order',
  'sales_quote',
  'sales_invoice',
  'sales_credit_memo',
  'component',
])

export const impactStatusSchema = z.enum([
  'operational',
  'degraded',
  'partial_outage',
  'major_outage',
])

export const impactAddSchema = z.object({
  organizationId: uuid().optional(),
  tenantId: uuid().optional(),
  id: uuid(),
  targetType: impactTargetTypeSchema,
  targetId: uuid().nullable().optional(),
  componentLabel: z.string().trim().max(200).nullable().optional(),
  impactStatus: impactStatusSchema.optional().default('degraded'),
  snapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  revenueAmountMinor: z.string().regex(/^\d+$/).nullable().optional(),
  revenueCurrency: z.string().trim().length(3).nullable().optional(),
}).refine(
  (value) => (value.targetType === 'component' ? !!value.componentLabel : !!value.targetId),
  { message: 'targetId required unless component' },
)

export const impactUpdateSchema = z.object({
  organizationId: uuid().optional(),
  tenantId: uuid().optional(),
  id: uuid(),
  impactId: uuid(),
  impactStatus: impactStatusSchema.optional(),
  snapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  revenueAmountMinor: z.string().regex(/^\d+$/).nullable().optional(),
  revenueCurrency: z.string().trim().length(3).nullable().optional(),
})

export const impactRemoveSchema = z.object({
  organizationId: uuid().optional(),
  tenantId: uuid().optional(),
  id: uuid(),
  impactId: uuid(),
})

export type IncidentImpactAddInput = z.infer<typeof impactAddSchema>
export type IncidentImpactUpdateInput = z.infer<typeof impactUpdateSchema>
export type IncidentImpactRemoveInput = z.infer<typeof impactRemoveSchema>
