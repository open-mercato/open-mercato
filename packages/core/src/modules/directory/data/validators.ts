import { z } from 'zod'

export const tenantCreateSchema = z.object({
  name: z.string().min(1).max(200),
  isActive: z.boolean().optional(),
})

export const organizationCreateSchema = z.object({
  tenantId: z.string().uuid(),
  name: z.string().min(1).max(200),
  isActive: z.boolean().optional(),
})

export type TenantCreateInput = z.infer<typeof tenantCreateSchema>
export type OrganizationCreateInput = z.infer<typeof organizationCreateSchema>

