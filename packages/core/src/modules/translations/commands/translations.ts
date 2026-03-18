import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { Knex } from 'knex'
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

function resolveKnex(ctx: CommandRuntimeContext): Knex {
  const em = ctx.container.resolve('em') as EntityManager
  return (em as unknown as { getConnection(): { getKnex(): Knex } }).getConnection().getKnex()
}

async function loadTranslationSnapshot(
  knex: Knex,
  entityType: string,
  entityId: string,
  tenantId: string,
  organizationId: string | null,
): Promise<TranslationSnapshot | null> {
  const row = await knex('entity_translations')
    .where({ entity_type: entityType, entity_id: entityId })
    .andWhereRaw('tenant_id is not distinct from ?', [tenantId])
    .andWhereRaw('organization_id is not distinct from ?', [organizationId])
    .first()

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
    const knex = resolveKnex(ctx)
    const snapshot = await loadTranslationSnapshot(knex, input.entityType, input.entityId, input.tenantId, input.organizationId)
    return { before: snapshot }
  },

  async execute(input, ctx) {
    const knex = resolveKnex(ctx)
    const existing = await knex('entity_translations')
      .where({ entity_type: input.entityType, entity_id: input.entityId })
      .andWhereRaw('tenant_id is not distinct from ?', [input.tenantId])
      .andWhereRaw('organization_id is not distinct from ?', [input.organizationId])
      .first()

    const now = knex.fn.now()

    if (existing) {
      await knex('entity_translations')
        .where({ id: existing.id })
        .update({ translations: input.translations, updated_at: now })
    } else {
      await knex('entity_translations').insert({
        entity_type: input.entityType,
        entity_id: input.entityId,
        organization_id: input.organizationId,
        tenant_id: input.tenantId,
        translations: input.translations,
        created_at: now,
        updated_at: now,
      })
    }

    await emitTranslationsEvent('translations.translation.updated', {
      entityType: input.entityType,
      entityId: input.entityId,
      organizationId: input.organizationId,
      tenantId: input.tenantId,
    }, { persistent: true }).catch(() => undefined)

    const saved = await knex('entity_translations')
      .where({ entity_type: input.entityType, entity_id: input.entityId })
      .andWhereRaw('tenant_id is not distinct from ?', [input.tenantId])
      .andWhereRaw('organization_id is not distinct from ?', [input.organizationId])
      .first()

    return { rowId: saved.id }
  },

  async captureAfter(input, _result, ctx) {
    const knex = resolveKnex(ctx)
    return await loadTranslationSnapshot(knex, input.entityType, input.entityId, input.tenantId, input.organizationId)
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
    const knex = resolveKnex(ctx)

    if (!before || !before.translations) {
      // Was a create — delete the record
      const resourceId = logEntry?.resourceId
      if (resourceId) {
        await knex('entity_translations').where({ id: resourceId }).del()
      }
    } else {
      // Was an update — restore previous translations
      const existing = await knex('entity_translations')
        .where({ entity_type: before.entityType, entity_id: before.entityId })
        .andWhereRaw('tenant_id is not distinct from ?', [before.tenantId])
        .andWhereRaw('organization_id is not distinct from ?', [before.organizationId])
        .first()

      if (existing) {
        await knex('entity_translations')
          .where({ id: existing.id })
          .update({ translations: before.translations, updated_at: knex.fn.now() })
      } else {
        await knex('entity_translations').insert({
          entity_type: before.entityType,
          entity_id: before.entityId,
          organization_id: before.organizationId,
          tenant_id: before.tenantId,
          translations: before.translations,
          created_at: knex.fn.now(),
          updated_at: knex.fn.now(),
        })
      }
    }
  },
}

const deleteTranslationCommand: CommandHandler<DeleteInput, { deleted: boolean }> = {
  id: 'translations.translation.delete',

  async prepare(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    const knex = resolveKnex(ctx)
    const snapshot = await loadTranslationSnapshot(knex, input.entityType, input.entityId, input.tenantId, input.organizationId)
    return { before: snapshot }
  },

  async execute(input, ctx) {
    const knex = resolveKnex(ctx)
    const count = await knex('entity_translations')
      .where({ entity_type: input.entityType, entity_id: input.entityId })
      .andWhereRaw('tenant_id is not distinct from ?', [input.tenantId])
      .andWhereRaw('organization_id is not distinct from ?', [input.organizationId])
      .del()

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
    const knex = resolveKnex(ctx)

    const existing = await knex('entity_translations')
      .where({ entity_type: before.entityType, entity_id: before.entityId })
      .andWhereRaw('tenant_id is not distinct from ?', [before.tenantId])
      .andWhereRaw('organization_id is not distinct from ?', [before.organizationId])
      .first()

    if (!existing) {
      await knex('entity_translations').insert({
        entity_type: before.entityType,
        entity_id: before.entityId,
        organization_id: before.organizationId,
        tenant_id: before.tenantId,
        translations: before.translations,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      })
    }
  },
}

registerCommand(saveTranslationCommand)
registerCommand(deleteTranslationCommand)
