import { z } from 'zod'

const uuid = () => z.string().uuid()

const scopedSchema = z.object({
  organizationId: uuid(),
  tenantId: uuid(),
})

const nonNegativeInt = () => z.number().int().min(0)

const policyFieldsSchema = z.object({
  storeId: uuid().nullable().optional(),
  productId: uuid().nullable().optional(),
  variantId: uuid().nullable().optional(),
  isStockManaged: z.boolean().optional(),
  allowBackorder: z.boolean().optional(),
  backorderLeadTimeDays: nonNegativeInt().nullable().optional(),
  preorderReleaseAt: z.coerce.date().nullable().optional(),
  lowStockThreshold: nonNegativeInt().nullable().optional(),
  minOrderQuantity: nonNegativeInt().nullable().optional(),
  maxOrderQuantity: nonNegativeInt().nullable().optional(),
  quantityIncrement: nonNegativeInt().nullable().optional(),
  hideWhenOutOfStock: z.boolean().optional(),
  isActive: z.boolean().optional(),
})

export const AVAILABILITY_POLICY_VARIANT_REQUIRES_PRODUCT_MESSAGE_KEY =
  'availability.policies.errors.variantRequiresProduct'
export const AVAILABILITY_POLICY_BACKORDER_REQUIRES_LEAD_TIME_MESSAGE_KEY =
  'availability.policies.errors.backorderRequiresLeadTime'
export const AVAILABILITY_POLICY_MAX_BELOW_MIN_MESSAGE_KEY = 'availability.policies.errors.maxBelowMin'

function refinePolicyConstraints<T extends z.ZodTypeAny>(schema: T) {
  return schema
    .refine((val: any) => !(val.variantId && !val.productId), {
      message: AVAILABILITY_POLICY_VARIANT_REQUIRES_PRODUCT_MESSAGE_KEY,
      path: ['variantId'],
    })
    .refine((val: any) => !(val.allowBackorder && val.backorderLeadTimeDays == null), {
      message: AVAILABILITY_POLICY_BACKORDER_REQUIRES_LEAD_TIME_MESSAGE_KEY,
      path: ['backorderLeadTimeDays'],
    })
    .refine(
      (val: any) =>
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
