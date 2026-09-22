import { z } from 'zod'

const uuid = () => z.string().uuid()

const emptyStringToNull = (value: unknown): unknown => {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

// Plain optional string fields that map to nullable columns: blanking a previously-set
// value on edit must transmit null to clear it, not be silently dropped. Mirrors
// `clearableStringSchema` in `customers/data/validators.ts`.
const clearableStringSchema = (max: number) =>
  z.preprocess(emptyStringToNull, z.string().trim().max(max).nullable().optional())

const clearableDateSchema = z.preprocess(
  emptyStringToNull,
  z.coerce.date().nullable().optional(),
)

const clearableUuidSchema = z.preprocess(emptyStringToNull, uuid().nullable().optional())

const clearableMetadataSchema = z.preprocess(
  (value) => (value === '' ? null : value),
  z.record(z.string(), z.unknown()).nullable().optional(),
)

// Slug-safe identifier used as the stable code across imports and rules (spec §5.1:
// "stable identifier used in imports and rules"). Mirrors the `tagCreateSchema.slug`
// pattern in `customers/data/validators.ts`.
const codeSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9_-]+$/, 'Code must be lowercase and may contain dashes or underscores')

const nameSchema = z.string().trim().min(1).max(200)

export const customerGroupKindValues = ['b2c', 'b2b', 'internal', 'partner'] as const
export const customerGroupKindSchema = z.enum(customerGroupKindValues)

export const customerGroupMembershipSourceValues = ['manual', 'import', 'rule', 'onboarding'] as const
export const customerGroupMembershipSourceSchema = z.enum(customerGroupMembershipSourceValues)

export const customerGroupCreateSchema = z.object({
  organizationId: uuid().nullable().optional(),
  tenantId: uuid(),
  code: codeSchema,
  name: nameSchema,
  description: clearableStringSchema(4000),
  kind: customerGroupKindSchema,
  parentId: clearableUuidSchema,
  priority: z.number().int().min(0),
  isDefault: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
  metadata: clearableMetadataSchema,
})

export type CustomerGroupCreateInput = z.infer<typeof customerGroupCreateSchema>

export const customerGroupUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(customerGroupCreateSchema.partial())

export type CustomerGroupUpdateInput = z.infer<typeof customerGroupUpdateSchema>

export const customerGroupDeleteSchema = z.object({
  id: uuid(),
})

export type CustomerGroupDeleteInput = z.infer<typeof customerGroupDeleteSchema>

export const customerGroupMembershipCreateSchema = z
  .object({
    organizationId: uuid().nullable().optional(),
    tenantId: uuid(),
    groupId: uuid(),
    customerId: uuid(),
    source: customerGroupMembershipSourceSchema.optional().default('manual'),
    validFrom: clearableDateSchema,
    validUntil: clearableDateSchema,
    assignedByUserId: clearableUuidSchema,
    notes: clearableStringSchema(2000),
  })
  .refine(
    (payload) =>
      !payload.validFrom || !payload.validUntil || payload.validFrom <= payload.validUntil,
    {
      message: 'validFrom must be before or equal to validUntil',
      path: ['validUntil'],
    },
  )

export type CustomerGroupMembershipCreateInput = z.infer<typeof customerGroupMembershipCreateSchema>

const customerGroupMembershipUpdateBaseSchema = z
  .object({
    id: uuid(),
  })
  .merge(
    z.object({
      organizationId: uuid().nullable().optional(),
      tenantId: uuid(),
      groupId: uuid().optional(),
      customerId: uuid().optional(),
      source: customerGroupMembershipSourceSchema.optional(),
      validFrom: clearableDateSchema,
      validUntil: clearableDateSchema,
      assignedByUserId: clearableUuidSchema,
      notes: clearableStringSchema(2000),
    }),
  )

export const customerGroupMembershipUpdateSchema = customerGroupMembershipUpdateBaseSchema.refine(
  (payload) =>
    !payload.validFrom || !payload.validUntil || payload.validFrom <= payload.validUntil,
  {
    message: 'validFrom must be before or equal to validUntil',
    path: ['validUntil'],
  },
)

export type CustomerGroupMembershipUpdateInput = z.infer<typeof customerGroupMembershipUpdateSchema>

export const customerGroupMembershipDeleteSchema = z.object({
  id: uuid(),
})

export type CustomerGroupMembershipDeleteInput = z.infer<typeof customerGroupMembershipDeleteSchema>

// Drag-reorder payload for the admin group list (Step 1.7): an ordered array of
// `CustomerGroup` ids. The reorder command rewrites `priority` in gaps of 10
// following this order — see spec R4 mitigation note.
export const customerGroupReorderSchema = z.object({
  tenantId: uuid(),
  ids: z.array(uuid()).min(1),
})

export type CustomerGroupReorderInput = z.infer<typeof customerGroupReorderSchema>
