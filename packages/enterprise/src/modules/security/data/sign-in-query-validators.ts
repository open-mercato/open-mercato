import { isIP } from 'node:net'
import { z } from 'zod'

const millisecondsPerDay = 86_400_000
const isoDate = z.string().datetime({ offset: true })

export const adminSignInQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  userId: z.string().uuid().optional(),
  email: z.string().trim().email().max(320).optional(),
  result: z.enum(['success', 'failure']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  ip: z.string().trim().refine((value) => isIP(value) !== 0).optional(),
  sort: z.enum(['occurredAt', 'occurredAt:asc', 'occurredAt:desc']).default('occurredAt'),
}).refine(({ from, to }) => {
  if (!from || !to) return true
  const span = Date.parse(to) - Date.parse(from)
  return span >= 0 && span <= 366 * millisecondsPerDay
}, { path: ['to'] })

export const signInDetailParamsSchema = z.object({ id: z.string().uuid() })

export const profileSignInQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  days: z.coerce.number().int().min(1).max(730).optional(),
}).strict()

export const profileSignInDtoSchema = z.object({
  id: z.string().uuid(),
  occurredAt: isoDate,
  result: z.enum(['success', 'failure']),
  reason: z.string().nullable(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  browserName: z.string().nullable(),
  browserMajor: z.string().nullable(),
  osName: z.string().nullable(),
  deviceType: z.enum(['desktop', 'mobile', 'tablet', 'bot', 'unknown']),
  isNewDevice: z.boolean(),
  mfaStatus: z.enum(['unknown', 'not_required', 'enrollment_required', 'bypassed', 'pending', 'verified']).nullable(),
})

export const adminSignInDtoSchema = profileSignInDtoSchema.extend({
  userId: z.string().uuid().nullable(),
  email: z.string(),
  userName: z.string().nullable(),
})

export type AdminSignInQuery = z.infer<typeof adminSignInQuerySchema>
