import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { type Kysely, sql } from 'kysely'
import type { EntityManager } from '@mikro-orm/postgresql'
import { emitTranslationsEvent } from '../events'

type TranslationSnapshot = {
  id: string | null
  entityType: string
  entityId: string
  translations: Record<string, Record<string, string | null>> | null
  organizationId: string | null
  tenantId: string
}

type TranslationUndoPayload = {
  before?: TranslationSnapshot | null
  after?: TranslationSnapshot | null
}

type SaveInput = {
  entityType: string
  entityId: string
  translations: Record<string, Record<string, string | null>>
  organizationId: string | null
  tenantId: string
}

type DeleteInput = {
  entityType: string
  entityId: string
  organizationId: string | null
  tenantId: string
}

function resolveDb(ctx: CommandRuntimeContext): Kysely<any> {
  const em = ctx.container.resolve('em') as EntityManager
  return em.getKysely<any>()
}

async function loadTranslationSnapshot(
  db: Kysely<any>,
  entityType: string,
  entityId: string,
  tenantId: string,
  organizationId: string | null,
): Promise<TranslationSnapshot | null> {
  const row = await (db as any)
    .selectFrom('entity_translations')
    .selectAll()
    .where('entity_type', '=', entityType)
    .where('entity_id', '=', entityId)
    .where(sql<boolean>`tenant_id is not distinct from ${tenantId}`)
    .where(sql<boolean>`organization_id is not distinct from ${organizationId}`)
    .executeTakeFirst() as Record<string, any> | undefined

  if (!row) return null
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    translations: row.translations ?? null,
    organizationId: row.organization_id ?? null,
    tenantId: row.tenant_id,
  }
}

const saveTranslationCommand: CommandHandler<SaveInput, { rowId: string }> = {
  id: 'translations.translation.save',

  async prepare(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    const db = resolveDb(ctx)
    const snapshot = await loadTranslationSnapshot(db, input.entityType, input.entityId, input.tenantId, input.organizationId)
    return { before: snapshot }
  },

  async execute(input, ctx) {
    const db = resolveDb(ctx) as any
    const existing = await db
      .selectFrom('entity_translations')
      .select(['id'])
      .where('entity_type', '=', input.entityType)
      .where('entity_id', '=', input.entityId)
      .where(sql<boolean>`tenant_id is not distinct from ${input.tenantId}`)
      .where(sql<boolean>`organization_id is not distinct from ${input.organizationId}`)
      .executeTakeFirst() as { id: string } | undefined

    if (existing) {
      await db
        .updateTable('entity_translations')
        .set({
          translations: sql`${JSON.stringify(input.translations)}::jsonb`,
          updated_at: sql`now()`,
        } as any)
        .where('id', '=', existing.id)
        .execute()
    } else {
      await db
        .insertInto('entity_translations')
        .values({
          entity_type: input.entityType,
          entity_id: input.entityId,
          organization_id: input.organizationId,
          tenant_id: input.tenantId,
          translations: sql`${JSON.stringify(input.translations)}::jsonb`,
          created_at: sql`now()`,
          updated_at: sql`now()`,
        } as any)
        .execute()
    }

    await emitTranslationsEvent('translations.translation.updated', {
      entityType: input.entityType,
      entityId: input.entityId,
      organizationId: input.organizationId,
      tenantId: input.tenantId,
    }, { persistent: true }).catch(() => undefined)

    const saved = await db
      .selectFrom('entity_translations')
      .select(['id'])
      .where('entity_type', '=', input.entityType)
      .where('entity_id', '=', input.entityId)
      .where(sql<boolean>`tenant_id is not distinct from ${input.tenantId}`)
      .where(sql<boolean>`organization_id is not distinct from ${input.organizationId}`)
      .executeTakeFirst() as { id: string } | undefined

    return { rowId: saved?.id ?? '' }
  },

  async captureAfter(input, _result, ctx) {
    const db = resolveDb(ctx)
    return await loadTranslationSnapshot(db, input.entityType, input.entityId, input.tenantId, input.organizationId)
  },

  async buildLog({ snapshots, result }) {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as TranslationSnapshot | null | undefined
    const after = snapshots.after as TranslationSnapshot | null | undefined
    return {
      actionLabel: translate('translations.audit.save', 'Save translation'),
      resourceKind: 'translations.translation',
      resourceId: result.rowId,
      tenantId: after?.tenantId ?? before?.tenantId ?? null,
      organizationId: after?.organizationId ?? before?.organizationId ?? null,
      snapshotBefore: before ?? null,
      snapshotAfter: after ?? null,
      payload: {
        undo: { before: before ?? null, after: after ?? null } satisfies TranslationUndoPayload,
      },
    }
  },

  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<TranslationUndoPayload>(logEntry)
    const before = payload?.before ?? null
    const db = resolveDb(ctx) as any

    if (!before || !before.translations) {
      // Was a create — delete the record
      const resourceId = logEntry?.resourceId
      if (resourceId) {
        await db.deleteFrom('entity_translations').where('id', '=', resourceId).execute()
      }
    } else {
      // Was an update — restore previous translations
      const existing = await db
        .selectFrom('entity_translations')
        .select(['id'])
        .where('entity_type', '=', before.entityType)
        .where('entity_id', '=', before.entityId)
        .where(sql<boolean>`tenant_id is not distinct from ${before.tenantId}`)
        .where(sql<boolean>`organization_id is not distinct from ${before.organizationId}`)
        .executeTakeFirst() as { id: string } | undefined

      if (existing) {
        await db
          .updateTable('entity_translations')
          .set({
            translations: sql`${JSON.stringify(before.translations)}::jsonb`,
            updated_at: sql`now()`,
          } as any)
          .where('id', '=', existing.id)
          .execute()
      } else {
        await db
          .insertInto('entity_translations')
          .values({
            entity_type: before.entityType,
            entity_id: before.entityId,
            organization_id: before.organizationId,
            tenant_id: before.tenantId,
            translations: sql`${JSON.stringify(before.translations)}::jsonb`,
            created_at: sql`now()`,
            updated_at: sql`now()`,
          } as any)
          .execute()
      }
    }
  },
}

const deleteTranslationCommand: CommandHandler<DeleteInput, { deleted: boolean }> = {
  id: 'translations.translation.delete',

  async prepare(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    const db = resolveDb(ctx)
    const snapshot = await loadTranslationSnapshot(db, input.entityType, input.entityId, input.tenantId, input.organizationId)
    return { before: snapshot }
  },

  async execute(input, ctx) {
    const db = resolveDb(ctx) as any
    const result = await db
      .deleteFrom('entity_translations')
      .where('entity_type', '=', input.entityType)
      .where('entity_id', '=', input.entityId)
      .where(sql<boolean>`tenant_id is not distinct from ${input.tenantId}`)
      .where(sql<boolean>`organization_id is not distinct from ${input.organizationId}`)
      .executeTakeFirst() as { numDeletedRows?: bigint | number } | undefined
    const count = Number(result?.numDeletedRows ?? 0)

    await emitTranslationsEvent('translations.translation.deleted', {
      entityType: input.entityType,
      entityId: input.entityId,
      organizationId: input.organizationId,
      tenantId: input.tenantId,
    }, { persistent: true }).catch(() => undefined)

    return { deleted: count > 0 }
  },

  async buildLog({ snapshots }) {
    const before = snapshots.before as TranslationSnapshot | null | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('translations.audit.delete', 'Delete translation'),
      resourceKind: 'translations.translation',
      resourceId: before.id ?? undefined,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: { before } satisfies TranslationUndoPayload,
      },
    }
  },

  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<TranslationUndoPayload>(logEntry)
    const before = payload?.before
    if (!before || !before.translations) return
    const db = resolveDb(ctx) as any

    const existing = await db
      .selectFrom('entity_translations')
      .select(['id'])
      .where('entity_type', '=', before.entityType)
      .where('entity_id', '=', before.entityId)
      .where(sql<boolean>`tenant_id is not distinct from ${before.tenantId}`)
      .where(sql<boolean>`organization_id is not distinct from ${before.organizationId}`)
      .executeTakeFirst() as { id: string } | undefined

    if (!existing) {
      await db
        .insertInto('entity_translations')
        .values({
          entity_type: before.entityType,
          entity_id: before.entityId,
          organization_id: before.organizationId,
          tenant_id: before.tenantId,
          translations: sql`${JSON.stringify(before.translations)}::jsonb`,
          created_at: sql`now()`,
          updated_at: sql`now()`,
        } as any)
        .execute()
    }
  },
}

registerCommand(saveTranslationCommand)
registerCommand(deleteTranslationCommand)
