import { z } from 'zod'

const uuid = () => z.string().uuid()

const scopedSchema = z.object({
  organizationId: uuid(),
  tenantId: uuid(),
})

export const assistedSellingReleaseModeSchema = z.enum(['rep', 'off'])
export type AssistedSellingReleaseMode = z.infer<typeof assistedSellingReleaseModeSchema>

export const assistedSellingStoreSettingsUpdateSchema = z
  .object({
    mode: assistedSellingReleaseModeSchema.optional(),
    proposalTtlSeconds: z.coerce.number().int().min(3600).max(1209600).optional(),
    maxProposalLines: z.coerce.number().int().min(1).max(100).optional(),
    conversationRetentionDays: z.coerce.number().int().min(1).max(3650).optional(),
    idleCloseDays: z.coerce.number().int().min(1).max(365).optional(),
  })
  .strict()
export type AssistedSellingStoreSettingsUpdateInput = z.infer<typeof assistedSellingStoreSettingsUpdateSchema>

export const assistedSellingStoreSettingsSaveSchema = scopedSchema
  .merge(assistedSellingStoreSettingsUpdateSchema)
  .extend({ storeId: uuid() })
  .strict()
export type AssistedSellingStoreSettingsSaveInput = z.infer<typeof assistedSellingStoreSettingsSaveSchema>
