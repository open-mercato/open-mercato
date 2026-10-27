import { z } from 'zod'

export const PRODUCT_USE_INTENT_HEADER = 'x-open-mercato-property-management-product-use'

export const productUseIntentSchema = z
  .object({
    sourceEntityId: z.string(),
    use: z.enum(['leasable', 'bookable']).nullable(),
    billingUnit: z.enum(['month', 'hour', 'day']).nullable(),
  })
  .transform((value) => ({
    ...value,
    billingUnit: value.use === 'leasable' ? 'month' as const : value.use === 'bookable' ? value.billingUnit === 'day' ? 'day' as const : 'hour' as const : null,
  }))

export type ProductUseIntent = z.infer<typeof productUseIntentSchema>

export function encodeProductUseIntent(intent: ProductUseIntent): string {
  return encodeURIComponent(JSON.stringify(intent))
}

export function decodeProductUseIntent(raw: string | null | undefined): ProductUseIntent | null {
  if (typeof raw !== 'string' || !raw.trim().length) return null
  try {
    return productUseIntentSchema.parse(JSON.parse(decodeURIComponent(raw)))
  } catch {
    return null
  }
}
