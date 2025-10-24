import { z } from 'zod'
import type { PerspectiveSettings } from '@open-mercato/shared/modules/perspectives/types'

export const perspectiveSettingsSchema: z.ZodType<PerspectiveSettings> = z.object({
  columnOrder: z.array(z.string().min(1)).max(120).optional(),
  columnVisibility: z.record(z.string(), z.boolean()).optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
  sorting: z
    .array(z.object({ id: z.string().min(1), desc: z.boolean().optional() }))
    .max(20)
    .optional(),
  pageSize: z.number().int().positive().max(500).optional(),
  searchValue: z.string().max(200).optional(),
})

export type { PerspectiveSettings }

export const perspectiveSaveSchema = z.object({
  perspectiveId: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
  settings: perspectiveSettingsSchema,
  isDefault: z.boolean().optional(),
  applyToRoles: z.array(z.string().uuid()).optional(),
  clearRoleIds: z.array(z.string().uuid()).optional(),
  setRoleDefault: z.boolean().optional(),
})

export const perspectiveDeleteSchema = z.object({
  force: z.boolean().optional(),
})

export const rolePerspectiveSaveSchema = z.object({
  roleIds: z.array(z.string().uuid()).min(1),
  name: z.string().min(1).max(120),
  settings: perspectiveSettingsSchema,
  setDefault: z.boolean().optional(),
})

export type PerspectiveSaveInput = z.infer<typeof perspectiveSaveSchema>
export type RolePerspectiveSaveInput = z.infer<typeof rolePerspectiveSaveSchema>
