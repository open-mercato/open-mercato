import { z } from 'zod'

export const tenantCreateSchema = z.object({
  name: z.string().min(1).max(200),
  isActive: z.boolean().optional(),
})

export const tenantUpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  isActive: z.boolean().optional(),
})

export const organizationCreateSchema = z.object({
  tenantId: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  isActive: z.boolean().optional(),
  parentId: z.string().uuid().nullable().optional(),
  childIds: z.array(z.string().uuid()).optional(),
})

export const organizationUpdateSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid().optional(),
  name: z.string().min(1).max(200).optional(),
  isActive: z.boolean().optional(),
  parentId: z.string().uuid().nullable().optional(),
  childIds: z.array(z.string().uuid()).optional(),
})

export type TenantCreateInput = z.infer<typeof tenantCreateSchema>
export type TenantUpdateInput = z.infer<typeof tenantUpdateSchema>
export type OrganizationCreateInput = z.infer<typeof organizationCreateSchema>
export type OrganizationUpdateInput = z.infer<typeof organizationUpdateSchema>
