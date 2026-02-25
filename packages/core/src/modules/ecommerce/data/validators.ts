import { z } from 'zod'

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const storeCreateSchema = z.object({
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  code: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/, 'Code must be lowercase alphanumeric with dashes/underscores'),
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(255).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with dashes'),
  status: z.enum(['draft', 'active', 'archived']).default('draft'),
  defaultLocale: z.string().min(2).max(10).default('en'),
  supportedLocales: z.array(z.string().min(2).max(10)).default([]),
  defaultCurrencyCode: z.string().length(3).default('USD'),
  isPrimary: z.boolean().default(false),
  settings: z.record(z.string(), z.unknown()).nullable().optional(),
})

export const storeUpdateSchema = z.object({
  id: z.string().uuid(),
  code: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/).optional(),
  name: z.string().min(1).max(255).optional(),
  slug: z.string().min(1).max(255).regex(/^[a-z0-9-]+$/).optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  defaultLocale: z.string().min(2).max(10).optional(),
  supportedLocales: z.array(z.string().min(2).max(10)).optional(),
  defaultCurrencyCode: z.string().length(3).optional(),
  isPrimary: z.boolean().optional(),
  settings: z.record(z.string(), z.unknown()).nullable().optional(),
})

export type StoreCreateInput = z.infer<typeof storeCreateSchema>
export type StoreUpdateInput = z.infer<typeof storeUpdateSchema>

// ---------------------------------------------------------------------------
// Store Domain
// ---------------------------------------------------------------------------

export const storeDomainCreateSchema = z.object({
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  storeId: z.string().uuid(),
  host: z.string().min(1).max(255).transform(v => v.toLowerCase().trim()),
  isPrimary: z.boolean().default(false),
  tlsMode: z.enum(['platform', 'external']).default('platform'),
  verificationStatus: z.enum(['pending', 'verified', 'failed']).default('pending'),
})

export const storeDomainUpdateSchema = z.object({
  id: z.string().uuid(),
  host: z.string().min(1).max(255).transform(v => v.toLowerCase().trim()).optional(),
  isPrimary: z.boolean().optional(),
  tlsMode: z.enum(['platform', 'external']).optional(),
  verificationStatus: z.enum(['pending', 'verified', 'failed']).optional(),
})

export type StoreDomainCreateInput = z.infer<typeof storeDomainCreateSchema>
export type StoreDomainUpdateInput = z.infer<typeof storeDomainUpdateSchema>

// ---------------------------------------------------------------------------
// Store Channel Binding
// ---------------------------------------------------------------------------

export const storeChannelBindingCreateSchema = z.object({
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  storeId: z.string().uuid(),
  salesChannelId: z.string().uuid(),
  priceKindId: z.string().uuid().nullable().optional(),
  catalogScope: z.record(z.string(), z.unknown()).nullable().optional(),
  isDefault: z.boolean().default(false),
})

export const storeChannelBindingUpdateSchema = z.object({
  id: z.string().uuid(),
  salesChannelId: z.string().uuid().optional(),
  priceKindId: z.string().uuid().nullable().optional(),
  catalogScope: z.record(z.string(), z.unknown()).nullable().optional(),
  isDefault: z.boolean().optional(),
})

export type StoreChannelBindingCreateInput = z.infer<typeof storeChannelBindingCreateSchema>
export type StoreChannelBindingUpdateInput = z.infer<typeof storeChannelBindingUpdateSchema>

// ---------------------------------------------------------------------------
// Storefront Checkout Session
// ---------------------------------------------------------------------------

export const checkoutSessionCreateSchema = z.object({
  cartToken: z.string().uuid(),
  locale: z.string().optional(),
})

export const checkoutSessionStateSchema = z.enum([
  'cart',
  'customer',
  'shipping',
  'review',
  'placing_order',
  'completed',
  'failed',
  'expired',
  'cancelled',
])

export const checkoutSessionStatusSchema = z.enum([
  'active',
  'completed',
  'failed',
  'expired',
  'cancelled',
])

export const checkoutTransitionActionSchema = z.enum([
  'set_customer',
  'set_shipping',
  'review',
  'place_order',
  'cancel',
])
export type CheckoutTransitionAction = z.infer<typeof checkoutTransitionActionSchema>

export const checkoutCustomerInfoSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  address: z.string().optional(),
})

export const checkoutShippingInfoSchema = z.object({
  line1: z.string().min(1),
  line2: z.string().optional(),
  city: z.string().optional(),
  region: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
})

export const checkoutTransitionSchema = z.object({
  action: checkoutTransitionActionSchema,
  idempotencyKey: z.string().min(8).max(255).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
})
