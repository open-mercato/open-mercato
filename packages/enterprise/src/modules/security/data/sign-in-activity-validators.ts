import { z } from 'zod'

export const signInEventSchema = z.object({
  id: z.string().uuid().optional(),
  userId: z.string().uuid().nullish(),
  tenantId: z.string().uuid().nullish(),
  organizationId: z.string().uuid().nullish(),
  attemptId: z.string().uuid(),
  email: z.string().min(1).max(320),
  ip: z.string().nullish(),
  userAgent: z.string().max(512).nullish(),
  occurredAt: z.string().datetime().nullish(),
  reason: z.enum([
    'invalid_password', 'invalid_credentials', 'account_deactivated',
    'tenant_unavailable', 'role_denied', 'after_interceptor_failed',
  ]).optional(),
})
