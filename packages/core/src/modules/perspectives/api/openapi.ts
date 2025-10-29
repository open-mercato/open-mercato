import { z } from 'zod'
import { perspectiveSettingsSchema } from '../data/validators'

export const perspectivesTag = 'Perspectives'

export const perspectivesErrorSchema = z.object({
  error: z.string(),
}).passthrough()

export const perspectiveDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  tableId: z.string(),
  settings: perspectiveSettingsSchema,
  isDefault: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
})

export const rolePerspectiveDtoSchema = perspectiveDtoSchema.extend({
  roleId: z.string().uuid(),
  tenantId: z.string().uuid().nullable(),
  organizationId: z.string().uuid().nullable(),
  roleName: z.string().nullable(),
})

export const perspectivesIndexResponseSchema = z.object({
  tableId: z.string(),
  perspectives: z.array(perspectiveDtoSchema),
  defaultPerspectiveId: z.string().uuid().nullable(),
  rolePerspectives: z.array(rolePerspectiveDtoSchema),
  roles: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      hasPerspective: z.boolean(),
      hasDefault: z.boolean(),
    }),
  ),
  canApplyToRoles: z.boolean(),
})

export const perspectiveSaveResponseSchema = z.object({
  perspective: perspectiveDtoSchema,
  rolePerspectives: z.array(rolePerspectiveDtoSchema),
  clearedRoleIds: z.array(z.string().uuid()),
})

export const perspectivesSuccessSchema = z.object({
  success: z.literal(true),
})

