import { uuid, z } from 'zod'


const scoped = z.object({
  organizationId: uuid(),
  tenantId: uuid(),
})

export const settingsUpsertSchema = scoped.extend({
  apiKey: z.string().min(1).max(30),
})

export type SettingsUpsertInput = z.infer<typeof settingsUpsertSchema>
