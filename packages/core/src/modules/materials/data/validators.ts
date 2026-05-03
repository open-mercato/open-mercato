import { z } from 'zod'

const uuid = () => z.string().uuid()

export const MATERIAL_KIND_VALUES = ['raw', 'semi', 'final', 'tool', 'indirect'] as const
export const MATERIAL_LIFECYCLE_STATE_VALUES = ['draft', 'active', 'phase_out', 'obsolete'] as const

export const materialKindSchema = z.enum(MATERIAL_KIND_VALUES)
export const materialLifecycleStateSchema = z.enum(MATERIAL_LIFECYCLE_STATE_VALUES)

const codeSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._\-]+$/, { message: 'materials.material.code.invalid' })

const nameSchema = z.string().trim().min(1).max(255)
const descriptionSchema = z.string().trim().max(4000)

// Sales-only formats — live on MaterialSalesProfile, not on Material master.
// GTIN: 8/12/13/14 digits per GS1 standards.
const gtinSchema = z.string().trim().regex(/^[0-9]{8}$|^[0-9]{12,14}$/, {
  message: 'materials.sales_profile.gtin.invalid',
})

// CN/HS: 2 to 10 digits (TARIC up to 10). Validation against PL providers deferred.
const commodityCodeSchema = z.string().trim().regex(/^[0-9]{2,10}$/, {
  message: 'materials.sales_profile.commodityCode.invalid',
})

const scopedSchema = z.object({
  organizationId: uuid(),
  tenantId: uuid(),
})

// ── Material (master) ───────────────────────────────────────────────────────────
//
// Note: `isSellable` is intentionally absent from create/update schemas — it is
// materialized by subscriber `subscribers/sync-sales-capability.ts` from the
// existence of a MaterialSalesProfile row. Direct mutation must be rejected at
// the command layer; validators here simply omit the field so passing it
// strict-fails. The other capability flags remain user-settable in Phase 1.

const baseMaterialFields = {
  code: codeSchema,
  name: nameSchema,
  description: descriptionSchema.optional().nullable(),
  kind: materialKindSchema,
  lifecycleState: materialLifecycleStateSchema.optional(),
  replacementMaterialId: uuid().optional().nullable(),
  baseUnitId: uuid().optional().nullable(),
  isPurchasable: z.boolean().optional(),
  isStockable: z.boolean().optional(),
  isProducible: z.boolean().optional(),
  isActive: z.boolean().optional(),
}

export const createMaterialSchema = scopedSchema.extend(baseMaterialFields).strict()

export const updateMaterialSchema = scopedSchema
  .extend({
    id: uuid(),
    code: codeSchema.optional(),
    name: nameSchema.optional(),
    description: descriptionSchema.optional().nullable(),
    kind: materialKindSchema.optional(),
    lifecycleState: materialLifecycleStateSchema.optional(),
    replacementMaterialId: uuid().optional().nullable(),
    baseUnitId: uuid().optional().nullable(),
    isPurchasable: z.boolean().optional(),
    isStockable: z.boolean().optional(),
    isProducible: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()

export type CreateMaterialInput = z.infer<typeof createMaterialSchema>
export type UpdateMaterialInput = z.infer<typeof updateMaterialSchema>

// ── MaterialSalesProfile (1:1 child) ────────────────────────────────────────────

const baseSalesProfileFields = {
  gtin: gtinSchema.optional().nullable(),
  commodityCode: commodityCodeSchema.optional().nullable(),
  isActive: z.boolean().optional(),
}

// Upsert via PUT /api/materials/[id]/sales-profile. The `materialId` comes from
// the URL path, not the body — so it is not part of the body schema.
export const upsertMaterialSalesProfileSchema = scopedSchema
  .extend(baseSalesProfileFields)
  .strict()

export type UpsertMaterialSalesProfileInput = z.infer<typeof upsertMaterialSalesProfileSchema>
