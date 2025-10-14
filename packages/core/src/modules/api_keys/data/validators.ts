import { z } from 'zod'

const uuid = z.string().uuid()

const expiresAtSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? undefined : date
}, z.date().nullable())

export const createApiKeySchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional().nullable(),
  tenantId: uuid.optional().nullable(),
  organizationId: uuid.optional().nullable(),
  roles: z.array(uuid).optional().default([]),
  expiresAt: expiresAtSchema.optional(),
})

export const updateApiKeySchema = createApiKeySchema.partial().extend({
  id: uuid,
})
