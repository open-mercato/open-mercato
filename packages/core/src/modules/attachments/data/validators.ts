import { z } from 'zod'

export const attachmentStorageConfigurationSchema = z.custom<Record<string, unknown>>((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
})

export const attachmentStorageScopeSchema = z.object({
  tenantId: z.string(),
  organizationId: z.string(),
}).refine((scope) => Boolean(scope.tenantId.trim()) === Boolean(scope.organizationId.trim()))
