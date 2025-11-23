import { z } from 'zod'

export const moduleConfigKeySchema = z.object({
  moduleId: z.string().trim().min(1, 'module id required').max(64),
  name: z.string().trim().min(1, 'config name required').max(128),
})

export const moduleConfigUpsertSchema = moduleConfigKeySchema.extend({
  value: z.unknown(),
})

export type ModuleConfigKey = z.infer<typeof moduleConfigKeySchema>
export type ModuleConfigUpsertInput = z.infer<typeof moduleConfigUpsertSchema>

export const upgradeActionScopeSchema = z.object({
  actionId: z.string().trim().min(1, 'action id required'),
  version: z.string().trim().min(1, 'version required'),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
})

export type UpgradeActionScopeInput = z.infer<typeof upgradeActionScopeSchema>
