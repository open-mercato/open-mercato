import { z } from 'zod'

export const EXTERNAL_ACCOUNT_ID_REGEX = /^[A-Za-z0-9_-]{1,128}$/
export const externalAccountIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(EXTERNAL_ACCOUNT_ID_REGEX, 'externalAccountId must match /^[A-Za-z0-9_-]{1,128}$/')

export const subjectEntityTypeSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_]+:[A-Za-z0-9_]+$/, 'subjectEntityType must be in the form "<module>:<entity>"')

export const accessStateSchema = z.enum(['pending', 'granted', 'grace', 'blocked'])

export const accessQuerySchema = z.object({
  externalAccountId: externalAccountIdSchema,
  productCode: z.string().min(1).max(128).default('external-app'),
})
export type AccessQuery = z.infer<typeof accessQuerySchema>

export const checkoutSchema = z.object({
  externalAccountId: externalAccountIdSchema,
  subjectEntityType: subjectEntityTypeSchema,
  subjectEntityId: z.string().uuid(),
  priceCode: z.string().min(1).max(128),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
  allowPromotionCodes: z.boolean().default(true),
  metadata: z.record(z.string(), z.string()).optional(),
})
export type CheckoutInput = z.infer<typeof checkoutSchema>

export const portalSchema = z.object({
  externalAccountId: externalAccountIdSchema,
  returnUrl: z.string().url(),
})
export type PortalInput = z.infer<typeof portalSchema>

export const cancelSchema = z.object({
  atPeriodEnd: z.boolean().default(true),
})
export type CancelInput = z.infer<typeof cancelSchema>

export const syncPlansSchema = z.object({
  manifestPath: z.string().min(1).optional(),
})
export type SyncPlansInput = z.infer<typeof syncPlansSchema>

export const refreshSubscriptionSchema = z.object({
  subscriptionId: z.string().uuid(),
})
export type RefreshSubscriptionInput = z.infer<typeof refreshSubscriptionSchema>
