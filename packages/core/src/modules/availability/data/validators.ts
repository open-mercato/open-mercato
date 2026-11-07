import { z } from 'zod'

const uuid = () => z.string().uuid()

const scopedSchema = z.object({
  organizationId: uuid(),
  tenantId: uuid(),
})

// The policy integer columns are Postgres `integer`; a larger value would reach the
// database and fail there as a 500 instead of a field error.
export const AVAILABILITY_POLICY_INTEGER_MAX = 2147483647
export const AVAILABILITY_POLICY_INTEGER_TOO_LARGE_MESSAGE_KEY = 'availability.policies.errors.integerTooLarge'

const boundedInt = (min: number) =>
  z.number().int().min(min).max(AVAILABILITY_POLICY_INTEGER_MAX, { message: AVAILABILITY_POLICY_INTEGER_TOO_LARGE_MESSAGE_KEY })
const nonNegativeInt = () => boundedInt(0)
const positiveInt = () => boundedInt(1)

const policyFieldsSchema = z.object({
  storeId: uuid().nullable().optional(),
  productId: uuid().nullable().optional(),
  variantId: uuid().nullable().optional(),
  isStockManaged: z.boolean().nullable().optional(),
  allowBackorder: z.boolean().optional(),
  backorderLeadTimeDays: nonNegativeInt().nullable().optional(),
  preorderReleaseAt: z.coerce.date().nullable().optional(),
  lowStockThreshold: nonNegativeInt().nullable().optional(),
  minOrderQuantity: nonNegativeInt().nullable().optional(),
  maxOrderQuantity: nonNegativeInt().nullable().optional(),
  quantityIncrement: positiveInt().nullable().optional(),
  hideWhenOutOfStock: z.boolean().optional(),
  isActive: z.boolean().optional(),
})

export const AVAILABILITY_POLICY_VARIANT_REQUIRES_PRODUCT_MESSAGE_KEY =
  'availability.policies.errors.variantRequiresProduct'
export const AVAILABILITY_POLICY_BACKORDER_REQUIRES_LEAD_TIME_MESSAGE_KEY =
  'availability.policies.errors.backorderRequiresLeadTime'
export const AVAILABILITY_POLICY_MAX_BELOW_MIN_MESSAGE_KEY = 'availability.policies.errors.maxBelowMin'

type PolicyConstraintFields = {
  productId?: string | null
  variantId?: string | null
  allowBackorder?: boolean
  backorderLeadTimeDays?: number | null
  minOrderQuantity?: number | null
  maxOrderQuantity?: number | null
}

function refinePolicyConstraints<T extends z.ZodType<PolicyConstraintFields>>(schema: T) {
  return schema
    .refine((val) => !(val.variantId && !val.productId), {
      message: AVAILABILITY_POLICY_VARIANT_REQUIRES_PRODUCT_MESSAGE_KEY,
      path: ['variantId'],
    })
    .refine((val) => !(val.allowBackorder && val.backorderLeadTimeDays == null), {
      message: AVAILABILITY_POLICY_BACKORDER_REQUIRES_LEAD_TIME_MESSAGE_KEY,
      path: ['backorderLeadTimeDays'],
    })
    .refine(
      (val) =>
        !(val.minOrderQuantity != null && val.maxOrderQuantity != null && val.maxOrderQuantity < val.minOrderQuantity),
      { message: AVAILABILITY_POLICY_MAX_BELOW_MIN_MESSAGE_KEY, path: ['maxOrderQuantity'] },
    )
}

export const availabilityPolicyCreateSchema = refinePolicyConstraints(
  scopedSchema.extend(policyFieldsSchema.shape),
)

// Cross-field constraints (variant requires product, backorder requires lead time, max >= min)
// are NOT re-checked here at the zod layer: a partial update payload may touch only one side of
// a constraint while the other side's value already satisfies it in the stored row. The update
// command (commands/policies.ts) re-validates the same constraints against the merged
// (existing-row + patch) record, where the full picture is available.
export const availabilityPolicyUpdateSchema = z
  .object({ id: uuid() })
  .merge(scopedSchema.extend(policyFieldsSchema.shape).partial())

export const availabilityPolicyDeleteSchema = scopedSchema.extend({ id: uuid() })

/** Re-applies the create-time cross-field constraints to a merged (existing + patch) record. Used by the update command. */
export const availabilityPolicyMergedConstraintsSchema = refinePolicyConstraints(policyFieldsSchema)

export type AvailabilityPolicyCreateInput = z.infer<typeof availabilityPolicyCreateSchema>
export type AvailabilityPolicyUpdateInput = z.infer<typeof availabilityPolicyUpdateSchema>

// Release 5 Phase 3 (§5.3, A3). Validates the `AvailabilityReservation.items` jsonb snapshot —
// exactly the per-line shape §5.3's data-model table names (`catalogProductId`, `catalogVariantId`,
// `requested`, `outcome`, `heldQuantity`, `backorderQuantity`). The `reserve`/`release`/`commit`
// commands that populate this column (Step 2.2) build their own richer in-memory line type
// (adding `key`/`available`, §4.1) and narrow it down to this snapshot before persisting.
export const availabilityReservationSourceTypeSchema = z.literal('checkout')
export const availabilityReservationStatusSchema = z.enum(['active', 'committed', 'released', 'expired'])
export const availabilityReservationLineOutcomeSchema = z.enum([
  'held',
  'not_tracked',
  'preorder',
  'backorder',
  'shortfall',
])

export const availabilityReservationItemSnapshotSchema = z.object({
  catalogProductId: uuid(),
  catalogVariantId: uuid().nullable(),
  requested: positiveInt(),
  outcome: availabilityReservationLineOutcomeSchema,
  heldQuantity: nonNegativeInt(),
  backorderQuantity: nonNegativeInt(),
})

export const availabilityReservationItemsSnapshotSchema = z
  .array(availabilityReservationItemSnapshotSchema)
  .min(1)

export type AvailabilityReservationSourceType = z.infer<typeof availabilityReservationSourceTypeSchema>
export type AvailabilityReservationStatus = z.infer<typeof availabilityReservationStatusSchema>
export type AvailabilityReservationLineOutcome = z.infer<typeof availabilityReservationLineOutcomeSchema>
export type AvailabilityReservationItemSnapshotInput = z.infer<typeof availabilityReservationItemSnapshotSchema>

// Step 2.2 (§4.1). `reserve`/`release`/`commit` input validation — items non-empty, each
// (catalogProductId, catalogVariantId) pair appears at most once per call (the caller sums
// duplicate cart lines), `ttlSeconds` bounded 60-3600 defaulting to 900 (A17), `reason`
// non-empty and bounded (audited text).
const availabilityReservationItemInputSchema = z.object({
  catalogProductId: uuid(),
  catalogVariantId: uuid().nullable().optional(),
  quantity: z.number().finite().positive(),
})

export const availabilityReserveInputSchema = scopedSchema.extend({
  items: z
    .array(availabilityReservationItemInputSchema)
    .min(1)
    .superRefine((items, ctx) => {
      const seen = new Set<string>()
      items.forEach((item, index) => {
        const key = `${item.catalogProductId}:${item.catalogVariantId ?? ''}`
        if (seen.has(key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, 'catalogVariantId'],
            message: 'availability.reservations.errors.duplicateLine',
          })
        }
        seen.add(key)
      })
    }),
  sourceType: z.literal('checkout'),
  sourceId: z.string().trim().min(1).max(200),
  idempotencyKey: z.string().trim().min(1).max(200),
  ttlSeconds: z.number().int().min(60).max(3600).optional().default(900),
  warehouseIds: z.array(uuid()).nullable().optional(),
})

export const availabilityReleaseInputSchema = scopedSchema.extend({
  idempotencyKey: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(1).max(200),
})

export const availabilityCommitInputSchema = scopedSchema.extend({
  idempotencyKey: z.string().trim().min(1).max(200),
  orderId: uuid(),
})

export type AvailabilityReserveInput = z.infer<typeof availabilityReserveInputSchema>
export type AvailabilityReleaseInput = z.infer<typeof availabilityReleaseInputSchema>
export type AvailabilityCommitInput = z.infer<typeof availabilityCommitInputSchema>
