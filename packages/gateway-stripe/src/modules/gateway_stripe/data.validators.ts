import { z } from 'zod'

export const stripeGatewaySettingsSchema = z.object({
  publishableKey: z.string().trim().optional(),
  secretKey: z.string().trim().optional(),
  webhookSecret: z.string().trim().optional(),
  captureMethod: z.enum(['automatic', 'manual']).default('automatic'),
  paymentMethodTypes: z.array(z.string().trim().min(1)).default(['card']),
  statementDescriptor: z.string().trim().max(22).optional(),
  allowPromotionCodes: z.coerce.boolean().optional(),
  successUrl: z.string().trim().url().optional(),
  cancelUrl: z.string().trim().url().optional(),
})

export type StripeGatewaySettings = z.infer<typeof stripeGatewaySettingsSchema>
