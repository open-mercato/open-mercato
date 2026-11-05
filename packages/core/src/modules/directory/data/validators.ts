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

const slugField = z.string().trim().toLowerCase().regex(/^[a-z0-9\-_]+$/).max(150).optional().nullable()
const logoUrlField = z
  .union([
    z.string().trim().url().max(2048).refine(
      (value) => value.startsWith('https://') || value.startsWith('http://'),
      { message: 'Logo URL must use http or https.' },
    ),
    z.string().trim().regex(/^\/api\/attachments\/(?:image|file)\/[A-Za-z0-9%_.~/?=&-]+$/).max(2048),
  ])
  .optional()
  .nullable()

export const organizationCreateSchema = z.object({
  tenantId: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  slug: slugField,
  logoUrl: logoUrlField,
  logoPreserveAspectRatio: z.boolean().optional(),
  isActive: z.boolean().optional(),
  parentId: z.string().uuid().nullable().optional(),
  childIds: z.array(z.string().uuid()).optional(),
})

export const organizationUpdateSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid().optional(),
  name: z.string().min(1).max(200).optional(),
  slug: slugField,
  logoUrl: logoUrlField,
  logoPreserveAspectRatio: z.boolean().optional(),
  isActive: z.boolean().optional(),
  parentId: z.string().uuid().nullable().optional(),
  childIds: z.array(z.string().uuid()).optional(),
})

export type TenantCreateInput = z.infer<typeof tenantCreateSchema>
export type TenantUpdateInput = z.infer<typeof tenantUpdateSchema>
export type OrganizationCreateInput = z.infer<typeof organizationCreateSchema>
export type OrganizationUpdateInput = z.infer<typeof organizationUpdateSchema>
