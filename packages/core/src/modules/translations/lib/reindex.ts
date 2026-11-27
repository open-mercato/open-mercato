import { z } from 'zod'

type TranslationReindexPayload = {
  entityType?: string
  entityId?: string
  tenantId?: string | null
  organizationId?: string | null
}

const recordIdSchema = z.guid()

export async function reindexTranslatedRecord(
  payload: TranslationReindexPayload,
  ctx: { resolve: <T = unknown>(name: string) => T },
): Promise<void> {
  const entityType = String(payload?.entityType || '')
  const entityId = String(payload?.entityId || '')
  if (!entityType || !entityId) return

  // Field labels are keyed by entity type and field key, without a single indexable record ID.
  if (entityType === 'entities:custom_field_def' && !recordIdSchema.safeParse(entityId).success) return

  const bus = ctx.resolve<{ emitEvent: (event: string, payload: unknown) => Promise<void> }>('eventBus')
  await bus.emitEvent('query_index.upsert_one', {
    entityType,
    recordId: entityId,
    tenantId: payload.tenantId ?? null,
    organizationId: payload.organizationId ?? null,
  })
}
