import { uuid, z } from 'zod'


const scoped = z.object({
  organizationId: uuid(),
  tenantId: uuid(),
})

export const settingsUpsertSchema = scoped.extend({
  apiKey: z.string().min(1).max(100),
  apiBaseUrl: z.string().min(1).max(100),
})

export type SettingsUpsertInput = z.infer<typeof settingsUpsertSchema>
