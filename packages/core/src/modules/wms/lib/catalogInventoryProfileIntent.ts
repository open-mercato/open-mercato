import { z } from 'zod'

const inventoryStrategySchema = z.enum(['fifo', 'lifo', 'fefo'])

export const catalogInventoryProfileIntentSchema = z.object({
  manageInventory: z.boolean(),
  defaultUom: z.string().trim().max(32).nullable().optional(),
  defaultStrategy: inventoryStrategySchema.optional(),
  trackLot: z.boolean().optional(),
  trackSerial: z.boolean().optional(),
  trackExpiration: z.boolean().optional(),
  reorderPoint: z.coerce.number().finite().min(0).nullable().optional(),
  safetyStock: z.coerce.number().finite().min(0).nullable().optional(),
}).superRefine((payload, ctx) => {
  if (!payload.manageInventory) return

  if (!payload.defaultUom || payload.defaultUom.trim().length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['defaultUom'],
      message: 'wms.widgets.catalog.inventoryProfile.errors.defaultUomRequired',
    })
  }

  if (!payload.defaultStrategy) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['defaultStrategy'],
      message: 'wms.widgets.catalog.inventoryProfile.errors.strategyRequired',
    })
  }

  if (payload.trackExpiration && payload.defaultStrategy !== 'fefo') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['defaultStrategy'],
      message: 'wms.widgets.catalog.inventoryProfile.errors.fefoRequired',
    })
  }
})

export type CatalogInventoryProfileIntent = z.infer<
  typeof catalogInventoryProfileIntentSchema
>

export const WMS_CATALOG_PROFILE_HEADER =
  'x-open-mercato-wms-catalog-profile'

export function encodeCatalogInventoryProfileIntent(
  intent: CatalogInventoryProfileIntent,
): string {
  return encodeURIComponent(JSON.stringify(intent))
}

export function decodeCatalogInventoryProfileIntent(
  rawHeader: string | null | undefined,
): CatalogInventoryProfileIntent | null {
  if (typeof rawHeader !== 'string' || rawHeader.trim().length === 0) {
    return null
  }

  const decoded = decodeURIComponent(rawHeader)
  const parsed = JSON.parse(decoded) as unknown
  return catalogInventoryProfileIntentSchema.parse(parsed)
}
