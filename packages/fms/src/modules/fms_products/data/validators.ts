import { z } from 'zod'
import type { ChargeCodeFieldSchema, ChargeUnit, ContractType } from './types.js'

/**
 * Charge unit enum validator
 */
export const chargeUnitSchema = z.enum(['per_container', 'per_piece', 'one_time'])

/**
 * Contract type enum validator
 */
export const contractTypeSchema = z.enum(['SPOT', 'NAC', 'BASKET'])

/**
 * Product type enum validator
 */
export const productTypeSchema = z.enum([
  'GFRT',
  'GBAF',
  'GBAF_PIECE',
  'GBOL',
  'GTHC',
  'GCUS',
  'CUSTOM',
])

/**
 * Variant type enum validator
 */
export const variantTypeSchema = z.enum(['container', 'simple'])

/**
 * Field schema definition validator (for charge code type-specific fields)
 */
export const chargeCodeFieldSchemaValidator = z.record(
  z.string(),
  z.object({
    type: z.enum(['string', 'integer', 'number', 'boolean', 'date']),
    required: z.boolean(),
    label: z.string(),
    description: z.string().optional(),
    unit: z.string().optional(),
    options: z
      .array(
        z.object({
          value: z.string(),
          label: z.string(),
        })
      )
      .optional(),
  })
)

// ========================================
// FmsChargeCode Validators
// ========================================
export const createChargeCodeSchema = z.object({
  organizationId: z.uuid(),
  tenantId: z.uuid(),
  code: z.string().min(1).max(50).regex(/^[A-Z_]+$/, 'Code must be uppercase letters and underscores only'),
  description: z.string().max(1000).optional().nullable(),
  chargeUnit: chargeUnitSchema,
  fieldSchema: chargeCodeFieldSchemaValidator.optional().nullable(),
  isActive: z.boolean().optional().default(true),
})

export const updateChargeCodeSchema = createChargeCodeSchema
  .partial()
  .omit({ organizationId: true, tenantId: true, code: true })
  .extend({
    updatedBy: z.string().uuid().optional().nullable(),
  })

export type CreateChargeCodeDto = z.infer<typeof createChargeCodeSchema>
export type UpdateChargeCodeDto = z.infer<typeof updateChargeCodeSchema>

// ========================================
// FmsProduct Validators (STI - Type Specific)
// ========================================

/**
 * Base product schema - shared fields for all product types
 */
const baseProductSchema = z.object({
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string().min(1).max(255),
  chargeCodeId: z.string().uuid(),
  contractorId: z.string().uuid().optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  internalNotes: z.string().max(5000).optional().nullable(),
  isActive: z.boolean().default(true),
  createdBy: z.string().uuid().optional().nullable(),
})

/**
 * Freight Product (GFRT) Validators
 */
export const createFreightProductSchema = baseProductSchema.extend({
  loop: z.string().min(1, 'Service loop is required'),
  source: z.string().min(1, 'Source port is required'),
  destination: z.string().min(1, 'Destination port is required'),
  transitTime: z.number().int().positive().optional().nullable(),
})

export const updateFreightProductSchema = createFreightProductSchema
  .partial()
  .omit({ organizationId: true, tenantId: true })
  .extend({
    updatedBy: z.string().uuid().optional().nullable(),
  })

export type CreateFreightProductDto = z.infer<typeof createFreightProductSchema>
export type UpdateFreightProductDto = z.infer<typeof updateFreightProductSchema>

/**
 * THC Product (GTHC) Validators
 */
export const createTHCProductSchema = baseProductSchema.extend({
  location: z.string().min(1, 'Location is required'),
  chargeType: z.enum(['origin', 'destination']).optional().nullable(),
})

export const updateTHCProductSchema = createTHCProductSchema
  .partial()
  .omit({ organizationId: true, tenantId: true })
  .extend({
    updatedBy: z.string().uuid().optional().nullable(),
  })

export type CreateTHCProductDto = z.infer<typeof createTHCProductSchema>
export type UpdateTHCProductDto = z.infer<typeof updateTHCProductSchema>

/**
 * Customs Product (GCUS) Validators
 */
export const createCustomsProductSchema = baseProductSchema.extend({
  location: z.string().min(1, 'Location is required'),
  serviceType: z.enum(['import', 'export', 'transit']).optional().nullable(),
})

export const updateCustomsProductSchema = createCustomsProductSchema
  .partial()
  .omit({ organizationId: true, tenantId: true })
  .extend({
    updatedBy: z.string().uuid().optional().nullable(),
  })

export type CreateCustomsProductDto = z.infer<typeof createCustomsProductSchema>
export type UpdateCustomsProductDto = z.infer<typeof updateCustomsProductSchema>

/**
 * Simple Products (GBAF, GBAF_PIECE, GBOL, CUSTOM) Validators
 */
export const createSimpleProductSchema = baseProductSchema

export const updateSimpleProductSchema = baseProductSchema
  .partial()
  .omit({ organizationId: true, tenantId: true })
  .extend({
    updatedBy: z.string().uuid().optional().nullable(),
  })

export type CreateSimpleProductDto = z.infer<typeof createSimpleProductSchema>
export type UpdateSimpleProductDto = z.infer<typeof updateSimpleProductSchema>

// ========================================
// FmsProductVariant Validators (STI - Type Specific)
// ========================================

/**
 * Base variant schema - shared fields for all variant types
 */
const baseVariantSchema = z.object({
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  productId: z.string().uuid(),
  providerContractorId: z.string().uuid().optional().nullable(),
  name: z.string().min(1).max(255).optional().nullable(),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
  createdBy: z.string().uuid().optional().nullable(),
})

/**
 * Container Variant Validators
 */
export const createContainerVariantSchema = baseVariantSchema.extend({
  containerSize: z.string().min(1, 'Container size is required'),
  containerType: z.string().optional().nullable(),
  weightLimit: z.number().positive().optional().nullable(),
  weightUnit: z.string().optional().nullable(),
})

export const updateContainerVariantSchema = createContainerVariantSchema
  .partial()
  .omit({ organizationId: true, tenantId: true, productId: true })
  .extend({
    updatedBy: z.string().uuid().optional().nullable(),
  })

export type CreateContainerVariantDto = z.infer<typeof createContainerVariantSchema>
export type UpdateContainerVariantDto = z.infer<typeof updateContainerVariantSchema>

/**
 * Simple Variant Validators
 */
export const createSimpleVariantSchema = baseVariantSchema

export const updateSimpleVariantSchema = baseVariantSchema
  .partial()
  .omit({ organizationId: true, tenantId: true, productId: true })
  .extend({
    updatedBy: z.string().uuid().optional().nullable(),
  })

export type CreateSimpleVariantDto = z.infer<typeof createSimpleVariantSchema>
export type UpdateSimpleVariantDto = z.infer<typeof updateSimpleVariantSchema>

// ========================================
// FmsProductPrice Validators
// ========================================

export const createProductPriceSchema = z
  .object({
    organizationId: z.string().uuid(),
    tenantId: z.string().uuid(),
    variantId: z.string().uuid(),
    validityStart: z.coerce.date(),
    validityEnd: z.coerce.date().optional().nullable(),
    contractType: contractTypeSchema,
    contractNumber: z.string().max(255).optional().nullable(),
    price: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Price must be a valid decimal with up to 2 decimal places'),
    currencyCode: z.string().length(3).regex(/^[A-Z]{3}$/, 'Currency code must be 3 uppercase letters (ISO 4217)').default('USD'),
    isActive: z.boolean().default(true),
    createdBy: z.string().uuid().optional().nullable(),
  })
  .refine(
    (data) => {
      if (data.validityEnd && data.validityStart) {
        return data.validityEnd >= data.validityStart
      }
      return true
    },
    {
      message: 'Validity end date must be equal to or after validity start date',
      path: ['validityEnd'],
    }
  )

export const updateProductPriceSchema = createProductPriceSchema
  .partial()
  .omit({ organizationId: true, tenantId: true, variantId: true })
  .extend({
    updatedBy: z.string().uuid().optional().nullable(),
  })

export type CreateProductPriceDto = z.infer<typeof createProductPriceSchema>
export type UpdateProductPriceDto = z.infer<typeof updateProductPriceSchema>

// ========================================
// Query/Filter Validators
// ========================================

export const productFilterSchema = z.object({
  chargeCodeId: z.string().uuid().optional(),
  contractorId: z.string().uuid().optional(),
  isActive: z.boolean().optional(),
  search: z.string().optional(),
})

export const priceFilterSchema = z.object({
  variantId: z.string().uuid().optional(),
  contractType: contractTypeSchema.optional(),
  isActive: z.boolean().optional(),
  validOn: z.coerce.date().optional(), // Find prices valid on a specific date
})

export type ProductFilter = z.infer<typeof productFilterSchema>
export type PriceFilter = z.infer<typeof priceFilterSchema>
