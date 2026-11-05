import { z } from 'zod'

export const stripeConfigSchema = z.object({
  captureMethod: z.enum(['automatic', 'manual']).default('automatic'),
  paymentTypes: z.array(z.string()).min(1).default(['card']),
  statementDescriptor: z.string().max(22).optional(),
  allowPromotionCodes: z.boolean().default(false),
})

export type StripeConfigData = z.infer<typeof stripeConfigSchema>
