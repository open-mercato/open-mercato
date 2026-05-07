import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import {
  reorderDictionaryEntriesCommandSchema,
  setDefaultDictionaryEntryCommandSchema,
  type ReorderDictionaryEntriesCommandInput,
  type SetDefaultDictionaryEntryCommandInput,
} from '@open-mercato/core/modules/dictionaries/data/validators'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

const RESOURCE_KIND = 'dictionaries.dictionary'
const INDEXER_ENTITY_TYPE = 'dictionaries:entry'

type DictionaryScope = {
  tenantId: string
  organizationId: string
}

const dictionaryCrudEvents: CrudEventsConfig = {
  module: 'dictionaries',
  entity: 'entry',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
    ...(ctx.syncOrigin ? { syncOrigin: ctx.syncOrigin } : {}),
  }),
}

function ensureScope(ctx: CommandRuntimeContext, scope: DictionaryScope): void {
  const tenantId = ctx.auth?.tenantId ?? null
  if (tenantId && tenantId !== scope.tenantId) {
    throw new CrudHttpError(403, { error: 'Forbidden' })
  }
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (organizationId && organizationId !== scope.organizationId) {
    throw new CrudHttpError(403, { error: 'Forbidden' })
  }
}

async function requireDictionary(
  em: EntityManager,
  id: string,
  scope: DictionaryScope,
): Promise<Dictionary> {
  const dictionary = await findOneWithDecryption(
    em,
    Dictionary,
    { id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    undefined,
    scope,
  )
  if (!dictionary) {
    throw new CrudHttpError(404, { error: 'Dictionary not found' })
  }
  return dictionary
}

type ReorderSnapshot = {
  dictionaryId: string
  scope: DictionaryScope
  positions: Array<{ id: string; position: number }>
}

type ReorderUndoPayload = {
  before?: ReorderSnapshot | null
  after?: ReorderSnapshot | null
}

const reorderDictionaryEntriesCommand: CommandHandler<
  ReorderDictionaryEntriesCommandInput,
  { dictionaryId: string; updatedIds: string[] }
> = {
  id: 'dictionaries.entries.reorder',
  async prepare(rawInput, ctx) {
    const parsed = reorderDictionaryEntriesCommandSchema.parse(rawInput)
    const scope: DictionaryScope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
    ensureScope(ctx, scope)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const ids = parsed.entries.map((e) => e.id)
    const existing = await findWithDecryption(
      em,
      DictionaryEntry,
      {
        id: { $in: ids },
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      } as FilterQuery<DictionaryEntry>,
      undefined,
      scope,
    )
    const before: ReorderSnapshot = {
      dictionaryId: parsed.dictionaryId,
      scope,
      positions: existing.map((entry) => ({ id: entry.id, position: entry.position ?? 0 })),
    }
    return { before }
  },
  async execute(rawInput, ctx) {
    const parsed = reorderDictionaryEntriesCommandSchema.parse(rawInput)
    const scope: DictionaryScope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
    ensureScope(ctx, scope)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const dictionary = await requireDictionary(em, parsed.dictionaryId, scope)
    const ids = parsed.entries.map((e) => e.id)
    const entries = await findWithDecryption(
      em,
      DictionaryEntry,
      {
        id: { $in: ids },
        dictionary,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      } as FilterQuery<DictionaryEntry>,
      undefined,
      scope,
    )
    const entryMap = new Map<string, DictionaryEntry>()
    for (const entry of entries) entryMap.set(entry.id, entry)

    const updatedIds: string[] = []
    await withAtomicFlush(em, [
      () => {
        for (const { id, position } of parsed.entries) {
          const entry = entryMap.get(id)
          if (!entry) continue
          entry.position = position
          entry.updatedAt = new Date()
          updatedIds.push(id)
        }
      },
    ], { transaction: true })

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    for (const entry of entries) {
      await emitCrudSideEffects({
        dataEngine,
        action: 'updated',
        entity: entry,
        identifiers: { id: entry.id, tenantId: entry.tenantId, organizationId: entry.organizationId },
        syncOrigin: ctx.syncOrigin,
        events: dictionaryCrudEvents,
        indexer: { entityType: INDEXER_ENTITY_TYPE },
      })
    }

    return { dictionaryId: parsed.dictionaryId, updatedIds }
  },
  captureAfter: async (rawInput, _result, ctx) => {
    const parsed = reorderDictionaryEntriesCommandSchema.parse(rawInput)
    const em = ctx.container.resolve('em') as EntityManager
    const scope: DictionaryScope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
    const ids = parsed.entries.map((e) => e.id)
    const current = await findWithDecryption(
      em,
      DictionaryEntry,
      {
        id: { $in: ids },
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      } as FilterQuery<DictionaryEntry>,
      undefined,
      scope,
    )
    const after: ReorderSnapshot = {
      dictionaryId: parsed.dictionaryId,
      scope,
      positions: current.map((entry) => ({ id: entry.id, position: entry.position ?? 0 })),
    }
    return after
  },
  buildLog: async ({ snapshots, result }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as ReorderSnapshot | undefined
    const after = snapshots.after as ReorderSnapshot | undefined
    if (!before || !after) return null
    return {
      actionLabel: translate('dictionaries.entries.audit.reorder', 'Reorder dictionary entries'),
      resourceKind: RESOURCE_KIND,
      resourceId: result.dictionaryId,
      tenantId: before.scope.tenantId,
      organizationId: before.scope.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      payload: {
        undo: { before, after } satisfies ReorderUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const undo = extractUndoPayload<ReorderUndoPayload>(logEntry)
    const before = undo?.before ?? (logEntry?.snapshotBefore as ReorderSnapshot | null | undefined) ?? null
    if (!before) return
    ensureScope(ctx, before.scope)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const ids = before.positions.map((p) => p.id)
    const entries = await findWithDecryption(
      em,
      DictionaryEntry,
      {
        id: { $in: ids },
        tenantId: before.scope.tenantId,
        organizationId: before.scope.organizationId,
      } as FilterQuery<DictionaryEntry>,
      undefined,
      before.scope,
    )
    const entryMap = new Map<string, DictionaryEntry>()
    for (const entry of entries) entryMap.set(entry.id, entry)

    await withAtomicFlush(em, [
      () => {
        for (const { id, position } of before.positions) {
          const entry = entryMap.get(id)
          if (!entry) continue
          entry.position = position
          entry.updatedAt = new Date()
        }
      },
    ], { transaction: true })

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    for (const entry of entries) {
      await emitCrudUndoSideEffects({
        dataEngine,
        action: 'updated',
        entity: entry,
        identifiers: { id: entry.id, tenantId: entry.tenantId, organizationId: entry.organizationId },
        syncOrigin: ctx.syncOrigin,
        events: dictionaryCrudEvents,
        indexer: { entityType: INDEXER_ENTITY_TYPE },
      })
    }
  },
}

type DefaultSnapshot = {
  dictionaryId: string
  scope: DictionaryScope
  previousDefaultIds: string[]
  newDefaultId: string
}

type DefaultUndoPayload = {
  before?: DefaultSnapshot | null
  after?: DefaultSnapshot | null
}

const setDefaultDictionaryEntryCommand: CommandHandler<
  SetDefaultDictionaryEntryCommandInput,
  { dictionaryId: string; entryId: string; clearedIds: string[] }
> = {
  id: 'dictionaries.entries.set_default',
  async prepare(rawInput, ctx) {
    const parsed = setDefaultDictionaryEntryCommandSchema.parse(rawInput)
    const scope: DictionaryScope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
    ensureScope(ctx, scope)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const dictionary = await requireDictionary(em, parsed.dictionaryId, scope)
    const previousDefaults = await findWithDecryption(
      em,
      DictionaryEntry,
      {
        dictionary,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        isDefault: true,
      } as FilterQuery<DictionaryEntry>,
      undefined,
      scope,
    )
    const before: DefaultSnapshot = {
      dictionaryId: parsed.dictionaryId,
      scope,
      previousDefaultIds: previousDefaults.map((entry) => entry.id),
      newDefaultId: parsed.entryId,
    }
    return { before }
  },
  async execute(rawInput, ctx) {
    const parsed = setDefaultDictionaryEntryCommandSchema.parse(rawInput)
    const scope: DictionaryScope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
    ensureScope(ctx, scope)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const dictionary = await requireDictionary(em, parsed.dictionaryId, scope)
    const targetEntry = await findOneWithDecryption(
      em,
      DictionaryEntry,
      {
        id: parsed.entryId,
        dictionary,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      } as FilterQuery<DictionaryEntry>,
      undefined,
      scope,
    )
    if (!targetEntry) {
      throw new CrudHttpError(404, { error: 'Dictionary entry not found' })
    }

    const existingDefaults = await findWithDecryption(
      em,
      DictionaryEntry,
      {
        dictionary,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        isDefault: true,
      } as FilterQuery<DictionaryEntry>,
      undefined,
      scope,
    )
    const clearedIds: string[] = []

    await withAtomicFlush(em, [
      () => {
        for (const entry of existingDefaults) {
          if (entry.id === targetEntry.id) continue
          entry.isDefault = false
          entry.updatedAt = new Date()
          clearedIds.push(entry.id)
        }
        targetEntry.isDefault = true
        targetEntry.updatedAt = new Date()
      },
    ], { transaction: true })

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    const touched = [targetEntry, ...existingDefaults.filter((entry) => entry.id !== targetEntry.id)]
    for (const entry of touched) {
      await emitCrudSideEffects({
        dataEngine,
        action: 'updated',
        entity: entry,
        identifiers: { id: entry.id, tenantId: entry.tenantId, organizationId: entry.organizationId },
        syncOrigin: ctx.syncOrigin,
        events: dictionaryCrudEvents,
        indexer: { entityType: INDEXER_ENTITY_TYPE },
      })
    }

    return { dictionaryId: parsed.dictionaryId, entryId: targetEntry.id, clearedIds }
  },
  captureAfter: async (rawInput, result, _ctx) => {
    const parsed = setDefaultDictionaryEntryCommandSchema.parse(rawInput)
    const scope: DictionaryScope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
    const after: DefaultSnapshot = {
      dictionaryId: parsed.dictionaryId,
      scope,
      previousDefaultIds: result.clearedIds,
      newDefaultId: result.entryId,
    }
    return after
  },
  buildLog: async ({ snapshots, result }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as DefaultSnapshot | undefined
    const after = snapshots.after as DefaultSnapshot | undefined
    if (!before || !after) return null
    return {
      actionLabel: translate('dictionaries.entries.audit.set_default', 'Set default dictionary entry'),
      resourceKind: RESOURCE_KIND,
      resourceId: result.dictionaryId,
      tenantId: before.scope.tenantId,
      organizationId: before.scope.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      payload: {
        undo: { before, after } satisfies DefaultUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const undo = extractUndoPayload<DefaultUndoPayload>(logEntry)
    const before = undo?.before ?? (logEntry?.snapshotBefore as DefaultSnapshot | null | undefined) ?? null
    if (!before) return
    ensureScope(ctx, before.scope)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const dictionary = await requireDictionary(em, before.dictionaryId, before.scope)

    const newDefault = before.newDefaultId
      ? await findOneWithDecryption(
          em,
          DictionaryEntry,
          {
            id: before.newDefaultId,
            dictionary,
            tenantId: before.scope.tenantId,
            organizationId: before.scope.organizationId,
          } as FilterQuery<DictionaryEntry>,
          undefined,
          before.scope,
        )
      : null
    const previousDefaults = before.previousDefaultIds.length > 0
      ? await findWithDecryption(
          em,
          DictionaryEntry,
          {
            id: { $in: before.previousDefaultIds },
            dictionary,
            tenantId: before.scope.tenantId,
            organizationId: before.scope.organizationId,
          } as FilterQuery<DictionaryEntry>,
          undefined,
          before.scope,
        )
      : []

    await withAtomicFlush(em, [
      () => {
        if (newDefault) {
          newDefault.isDefault = false
          newDefault.updatedAt = new Date()
        }
        for (const entry of previousDefaults) {
          entry.isDefault = true
          entry.updatedAt = new Date()
        }
      },
    ], { transaction: true })

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    const touched = [
      ...(newDefault ? [newDefault] : []),
      ...previousDefaults,
    ]
    for (const entry of touched) {
      await emitCrudUndoSideEffects({
        dataEngine,
        action: 'updated',
        entity: entry,
        identifiers: { id: entry.id, tenantId: entry.tenantId, organizationId: entry.organizationId },
        syncOrigin: ctx.syncOrigin,
        events: dictionaryCrudEvents,
        indexer: { entityType: INDEXER_ENTITY_TYPE },
      })
    }
  },
}

registerCommand(reorderDictionaryEntriesCommand)
registerCommand(setDefaultDictionaryEntryCommand)
