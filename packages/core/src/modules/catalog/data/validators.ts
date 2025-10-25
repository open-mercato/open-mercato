import { z } from 'zod'

const uuid = () => z.string().uuid()

const scoped = z.object({
  organizationId: uuid(),
  tenantId: uuid(),
})

const currencyCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Z]{3}$/, 'currency code must be a three-letter ISO code')

const metadataSchema = z.record(z.string(), z.unknown()).optional()

const optionConfigurationSchema = z
  .array(
    z.object({
      optionId: uuid(),
      optionValueIds: z.array(uuid()).min(1),
    })
  )
  .optional()

export const productCreateSchema = scoped.extend({
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(4000).optional(),
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9\-_]+$/, 'code must contain lowercase letters, digits, hyphen, or underscore')
    .max(150)
    .optional(),
  statusEntryId: uuid().optional(),
  primaryCurrencyCode: currencyCodeSchema.optional(),
  defaultUnit: z.string().trim().max(50).optional(),
  channelIds: z.array(uuid()).optional(),
  isConfigurable: z.boolean().optional(),
  isActive: z.boolean().optional(),
  metadata: metadataSchema,
})

export const productUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(productCreateSchema.partial())

export const variantCreateSchema = scoped.extend({
  productId: uuid(),
  name: z.string().trim().max(255).optional(),
  sku: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9\-_\.]+$/)
    .max(191)
    .optional(),
  barcode: z.string().trim().max(191).optional(),
  statusEntryId: uuid().optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  weightValue: z.coerce.number().min(0).optional(),
  weightUnit: z.string().trim().max(25).optional(),
  dimensions: z
    .object({
      width: z.coerce.number().min(0).optional(),
      height: z.coerce.number().min(0).optional(),
      depth: z.coerce.number().min(0).optional(),
      unit: z.string().trim().max(25).optional(),
    })
    .optional(),
  metadata: metadataSchema,
  optionConfiguration: optionConfigurationSchema,
})

export const variantUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(variantCreateSchema.partial())

export const optionCreateSchema = scoped.extend({
  productId: uuid(),
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9\-_]+$/)
    .max(150),
  label: z.string().trim().min(1).max(255),
  description: z.string().trim().max(2000).optional(),
  position: z.coerce.number().int().min(0).max(1000).optional(),
  isRequired: z.boolean().optional(),
  isMultiple: z.boolean().optional(),
  metadata: metadataSchema,
})

export const optionUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(optionCreateSchema.partial())

export const optionValueCreateSchema = scoped.extend({
  optionId: uuid(),
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9\-_]+$/)
    .max(150),
  label: z.string().trim().min(1).max(255),
  description: z.string().trim().max(2000).optional(),
  position: z.coerce.number().int().min(0).max(1000).optional(),
  metadata: metadataSchema,
})

export const optionValueUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(optionValueCreateSchema.partial())

export const priceCreateSchema = scoped.extend({
  variantId: uuid(),
  currencyCode: currencyCodeSchema,
  kind: z.enum(['list', 'sale', 'tier', 'custom']).optional(),
  minQuantity: z.coerce.number().int().min(1).optional(),
  maxQuantity: z.coerce.number().int().min(1).optional(),
  unitPriceNet: z.coerce.number().min(0).optional(),
  unitPriceGross: z.coerce.number().min(0).optional(),
  taxRate: z.coerce.number().min(0).max(100).optional(),
  metadata: metadataSchema,
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
})

export const priceUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(priceCreateSchema.partial())

export type ProductCreateInput = z.infer<typeof productCreateSchema>
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>
export type VariantCreateInput = z.infer<typeof variantCreateSchema>
export type VariantUpdateInput = z.infer<typeof variantUpdateSchema>
export type OptionCreateInput = z.infer<typeof optionCreateSchema>
export type OptionUpdateInput = z.infer<typeof optionUpdateSchema>
export type OptionValueCreateInput = z.infer<typeof optionValueCreateSchema>
export type OptionValueUpdateInput = z.infer<typeof optionValueUpdateSchema>
export type PriceCreateInput = z.infer<typeof priceCreateSchema>
export type PriceUpdateInput = z.infer<typeof priceUpdateSchema>
