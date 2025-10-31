import type { EntityManager } from '@mikro-orm/postgresql'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import {
  normalizeDictionaryValue,
  sanitizeDictionaryColor,
  sanitizeDictionaryIcon,
} from '@open-mercato/core/modules/dictionaries/lib/utils'
import {
  registerCommand,
  type CommandHandler,
  type CommandRuntimeContext,
} from '@open-mercato/shared/lib/commands'
import { buildChanges, requireId } from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { z } from 'zod'

type DictionaryScope = {
  tenantId: string
  organizationId: string
}

export type DictionaryEntrySnapshot = {
  id: string
  dictionaryId: string
  dictionaryKey: string
  organizationId: string
  tenantId: string
  value: string
  label: string
  color: string | null
  icon: string | null
  createdAt: string
  updatedAt: string
}

export type DictionaryEntryUndoPayload = {
  before?: DictionaryEntrySnapshot | null
  after?: DictionaryEntrySnapshot | null
}

const ENTRY_CHANGE_KEYS = ['value', 'label', 'color', 'icon'] as const

type ResolveDictionaryForCreate<TCreate> = (options: {
  em: EntityManager
  ctx: CommandRuntimeContext
  parsed: TCreate
}) => Promise<{ dictionary: Dictionary; scope: DictionaryScope }>

type ResolveEntry<TInput> = (options: {
  em: EntityManager
  ctx: CommandRuntimeContext
  id: string
  parsed?: TInput
}) => Promise<{ entry: DictionaryEntry; dictionary: Dictionary; scope: DictionaryScope }>

type EnsureDictionaryForUndo = (options: {
  em: EntityManager
  ctx: CommandRuntimeContext
  snapshot: DictionaryEntrySnapshot
}) => Promise<Dictionary | null>

type EnsureScopeFn = (ctx: CommandRuntimeContext, scope: DictionaryScope) => void

type DictionaryEntryCommandLabels = {
  singular?: string
  create?: string
  update?: string
  delete?: string
}

export type DictionaryEntryCommandConfig<TCreate, TUpdate> = {
  commandPrefix: string
  resourceKind: string
  translationKeyPrefix?: string
  createSchema: z.ZodType<TCreate>
  updateSchema: z.ZodType<TUpdate>
  resolveDictionaryForCreate: ResolveDictionaryForCreate<TCreate>
  resolveEntry: ResolveEntry<TUpdate>
  ensureScope?: EnsureScopeFn
  ensureDictionaryForUndo?: EnsureDictionaryForUndo
  duplicateError?: string
  labels?: DictionaryEntryCommandLabels
}

function toScopeEnsurer(fn: EnsureScopeFn | undefined): EnsureScopeFn {
  return typeof fn === 'function' ? fn : () => {}
}

async function loadSnapshot(em: EntityManager, id: string): Promise<DictionaryEntrySnapshot | null> {
  const entry = await em.findOne(DictionaryEntry, id, { populate: ['dictionary'] })
  if (!entry) return null
  return {
    id: entry.id,
    dictionaryId: entry.dictionary.id,
   dictionaryKey: entry.dictionary.key,
    organizationId: entry.organizationId,
    tenantId: entry.tenantId,
    value: entry.value,
    label: entry.label,
    color: entry.color ?? null,
    icon: entry.icon ?? null,
    createdAt:
      entry.createdAt instanceof Date
        ? entry.createdAt.toISOString()
        : new Date(entry.createdAt).toISOString(),
    updatedAt:
      entry.updatedAt instanceof Date
        ? entry.updatedAt.toISOString()
        : new Date(entry.updatedAt).toISOString(),
  }
}

function applySnapshot(entry: DictionaryEntry, snapshot: DictionaryEntrySnapshot): void {
  entry.value = snapshot.value
  entry.normalizedValue = normalizeDictionaryValue(snapshot.value)
  entry.label = snapshot.label
  entry.color = snapshot.color ?? null
  entry.icon = snapshot.icon ?? null
  entry.organizationId = snapshot.organizationId
  entry.tenantId = snapshot.tenantId
  entry.createdAt = new Date(snapshot.createdAt)
  entry.updatedAt = new Date(snapshot.updatedAt)
}

type UndoEnvelope<T> = {
  undo?: T
  value?: { undo?: T }
  __redoInput?: unknown
  [key: string]: unknown
}

function extractUndoPayload<T>(logEntry: { commandPayload?: unknown } | null | undefined): T | null {
  if (!logEntry) return null
  const payload = logEntry.commandPayload as UndoEnvelope<T> | undefined
  if (!payload || typeof payload !== 'object') return null
  if (payload.undo) return payload.undo
  if (payload.value && typeof payload.value === 'object' && payload.value.undo) {
    return payload.value.undo as T
  }
  for (const [key, value] of Object.entries(payload)) {
    if (key === '__redoInput') continue
    if (value && typeof value === 'object' && 'undo' in value) {
      return (value as { undo?: T }).undo ?? null
    }
  }
  return null
}

function ensureDictionaryForUndoFactory(
  fallback?: EnsureDictionaryForUndo
): EnsureDictionaryForUndo {
  if (fallback) return fallback
  return async ({ em, snapshot }) => {
    const dictionary = await em.findOne(Dictionary, snapshot.dictionaryId)
    return dictionary ?? null
  }
}

function getDuplicateError(config: DictionaryEntryCommandConfig<any, any>): string {
  return config.duplicateError ?? 'Value already exists in this dictionary.'
}

function sanitizeCreatePayload(input: any): {
  value: string
  normalized: string
  label: string
  color: string | null
  icon: string | null
} {
  const rawValue = typeof input?.value === 'string' ? input.value.trim() : ''
  if (!rawValue) {
    throw new CrudHttpError(400, { error: 'Dictionary entry value is required.' })
  }
  const normalized = normalizeDictionaryValue(rawValue)
  const rawLabel = typeof input?.label === 'string' ? input.label.trim() : ''
  const label = rawLabel || rawValue
  const color = sanitizeDictionaryColor(input?.color ?? null)
  const icon = sanitizeDictionaryIcon(input?.icon ?? null)
  return { value: rawValue, normalized, label, color, icon }
}

function sanitizeUpdatePayload(input: any): {
  value?: string
  normalized?: string
  label?: string
  color?: string | null
  icon?: string | null
} {
  const payload: {
    value?: string
    normalized?: string
    label?: string
    color?: string | null
    icon?: string | null
  } = {}
  if (Object.prototype.hasOwnProperty.call(input, 'value')) {
    const rawValue = typeof input?.value === 'string' ? input.value.trim() : ''
    if (!rawValue) {
      throw new CrudHttpError(400, { error: 'Dictionary entry value is required.' })
    }
    payload.value = rawValue
    payload.normalized = normalizeDictionaryValue(rawValue)
  }
  if (Object.prototype.hasOwnProperty.call(input, 'label')) {
    const rawLabel = typeof input?.label === 'string' ? input.label.trim() : ''
    payload.label = rawLabel
  }
  if (Object.prototype.hasOwnProperty.call(input, 'color')) {
    payload.color = sanitizeDictionaryColor(input?.color ?? null)
  }
  if (Object.prototype.hasOwnProperty.call(input, 'icon')) {
    payload.icon = sanitizeDictionaryIcon(input?.icon ?? null)
  }
  return payload
}

export function registerDictionaryEntryCommands<TCreate, TUpdate>(
  config: DictionaryEntryCommandConfig<TCreate, TUpdate>
): void {
  const scopeEnsurer = toScopeEnsurer(config.ensureScope)
  const ensureDictionaryForUndo = ensureDictionaryForUndoFactory(config.ensureDictionaryForUndo)
  const translationKeyPrefix = config.translationKeyPrefix ?? config.commandPrefix
  const fallbackSingular = config.labels?.singular ?? 'Dictionary entry'
  const fallbackCreate = config.labels?.create ?? `Create ${fallbackSingular}`
  const fallbackUpdate = config.labels?.update ?? `Update ${fallbackSingular}`
  const fallbackDelete = config.labels?.delete ?? `Delete ${fallbackSingular}`
  const duplicateMessage = getDuplicateError(config)

  const createCommand: CommandHandler<
    ReturnType<typeof config.createSchema['parse']>,
    { entryId: string }
  > = {
    id: `${config.commandPrefix}.create`,
    async execute(rawInput, ctx) {
      const parsed = config.createSchema.parse(rawInput)
      const em = ctx.container.resolve<EntityManager>('em').fork()
      const { dictionary, scope } = await config.resolveDictionaryForCreate({ em, ctx, parsed })
      scopeEnsurer(ctx, scope)

      const { value, normalized, label, color, icon } = sanitizeCreatePayload(parsed)
      const duplicate = await em.findOne(DictionaryEntry, {
        dictionary,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        normalizedValue: normalized,
      })
      if (duplicate) {
        throw new CrudHttpError(409, { error: duplicateMessage })
      }

      const entry = em.create(DictionaryEntry, {
        dictionary,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        value,
        normalizedValue: normalized,
        label,
        color,
        icon,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(entry)
      await em.flush()
      return { entryId: entry.id }
    },
    captureAfter: async (_input, result, ctx) => {
      const em = ctx.container.resolve<EntityManager>('em')
      return loadSnapshot(em, result.entryId)
    },
    buildLog: async ({ result, snapshots }) => {
      const after = snapshots.after as DictionaryEntrySnapshot | undefined
      if (!after) return null
      const { translate } = await resolveTranslations()
      return {
        actionLabel: translate(`${translationKeyPrefix}.audit.create`, fallbackCreate),
        resourceKind: config.resourceKind,
        resourceId: result.entryId,
        tenantId: after.tenantId,
        organizationId: after.organizationId,
        snapshotAfter: after,
        payload: {
          undo: { after } satisfies DictionaryEntryUndoPayload,
        },
      }
    },
    undo: async ({ logEntry, ctx }) => {
      const undo = extractUndoPayload<DictionaryEntryUndoPayload>(logEntry)
      const after =
        undo?.after ??
        (logEntry?.snapshotAfter as DictionaryEntrySnapshot | null | undefined) ??
        null
      if (!after) return
      const em = ctx.container.resolve<EntityManager>('em').fork()
      scopeEnsurer(ctx, { tenantId: after.tenantId, organizationId: after.organizationId })
      const entry = await em.findOne(DictionaryEntry, after.id)
      if (entry) {
      await em.removeAndFlush(entry)
      return
    }
    await em.nativeDelete(DictionaryEntry, { id: after.id })
  },
}

  const updateCommand: CommandHandler<
    ReturnType<typeof config.updateSchema['parse']>,
    { entryId: string }
  > = {
    id: `${config.commandPrefix}.update`,
    async prepare(input, ctx) {
      const id = requireId(input, 'Dictionary entry id is required')
      const em = ctx.container.resolve<EntityManager>('em')
      const snapshot = await loadSnapshot(em, id)
      if (snapshot) {
        scopeEnsurer(ctx, { tenantId: snapshot.tenantId, organizationId: snapshot.organizationId })
      }
      return snapshot ? { before: snapshot } : {}
    },
    async execute(rawInput, ctx) {
      const parsed = config.updateSchema.parse(rawInput)
      const em = ctx.container.resolve<EntityManager>('em').fork()
      const id = requireId(parsed, 'Dictionary entry id is required')
      const { entry, dictionary, scope } = await config.resolveEntry({ em, ctx, id, parsed })
      scopeEnsurer(ctx, scope)

      const updates = sanitizeUpdatePayload(parsed)
      if (updates.value !== undefined && updates.normalized !== undefined) {
        if (updates.normalized !== entry.normalizedValue) {
          const duplicate = await em.findOne(DictionaryEntry, {
            dictionary,
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            normalizedValue: updates.normalized,
            id: { $ne: entry.id },
          } as any)
          if (duplicate) {
            throw new CrudHttpError(409, { error: duplicateMessage })
          }
          entry.value = updates.value
          entry.normalizedValue = updates.normalized
          if (updates.label === undefined) {
            entry.label = entry.value
          }
        }
      }
      if (updates.label !== undefined) {
        entry.label = updates.label || entry.value
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'color')) {
        entry.color = updates.color ?? null
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'icon')) {
        entry.icon = updates.icon ?? null
      }
      await em.flush()
      return { entryId: entry.id }
    },
    captureAfter: async (_input, result, ctx) => {
      const em = ctx.container.resolve<EntityManager>('em')
      return loadSnapshot(em, result.entryId)
    },
    buildLog: async ({ snapshots }) => {
      const before = snapshots.before as DictionaryEntrySnapshot | undefined
      const after = snapshots.after as DictionaryEntrySnapshot | undefined
      if (!before || !after) return null
      const { translate } = await resolveTranslations()
      return {
        actionLabel: translate(`${translationKeyPrefix}.audit.update`, fallbackUpdate),
        resourceKind: config.resourceKind,
        resourceId: before.id,
        tenantId: before.tenantId,
        organizationId: before.organizationId,
        snapshotBefore: before,
        snapshotAfter: after,
        changes: buildChanges(
          before as Record<string, unknown>,
          after as Record<string, unknown>,
          ENTRY_CHANGE_KEYS,
        ),
        payload: {
          undo: { before, after } satisfies DictionaryEntryUndoPayload,
        },
      }
    },
    undo: async ({ logEntry, ctx }) => {
      const undo = extractUndoPayload<DictionaryEntryUndoPayload>(logEntry)
      const before =
        undo?.before ??
        (logEntry?.snapshotBefore as DictionaryEntrySnapshot | null | undefined) ??
        null
      if (!before) return
      const em = ctx.container.resolve<EntityManager>('em').fork()
      scopeEnsurer(ctx, { tenantId: before.tenantId, organizationId: before.organizationId })
      const dictionary = await ensureDictionaryForUndo({ em, ctx, snapshot: before })
      if (!dictionary) return
      let entry = await em.findOne(DictionaryEntry, before.id)
      if (!entry) {
        entry = em.create(DictionaryEntry, {
          id: before.id,
          dictionary,
          tenantId: before.tenantId,
          organizationId: before.organizationId,
          value: before.value,
          normalizedValue: normalizeDictionaryValue(before.value),
          label: before.label,
          color: before.color,
          icon: before.icon,
          createdAt: new Date(before.createdAt),
          updatedAt: new Date(before.updatedAt),
        })
        em.persist(entry)
      } else {
        entry.dictionary = dictionary
        applySnapshot(entry, before)
      }
      await em.flush()
    },
  }

  const deleteCommand: CommandHandler<
    { body?: Record<string, unknown>; query?: Record<string, unknown> },
    { entryId: string }
  > = {
    id: `${config.commandPrefix}.delete`,
    async prepare(input, ctx) {
      const id = requireId(input, 'Dictionary entry id is required')
      const em = ctx.container.resolve<EntityManager>('em')
      const snapshot = await loadSnapshot(em, id)
      if (snapshot) {
        scopeEnsurer(ctx, { tenantId: snapshot.tenantId, organizationId: snapshot.organizationId })
      }
      return snapshot ? { before: snapshot } : {}
    },
    async execute(input, ctx) {
      const id = requireId(input, 'Dictionary entry id is required')
      const em = ctx.container.resolve<EntityManager>('em').fork()
      const { entry, scope } = await config.resolveEntry({ em, ctx, id })
      scopeEnsurer(ctx, scope)
      em.remove(entry)
      await em.flush()
      return { entryId: id }
    },
    buildLog: async ({ snapshots }) => {
      const before = snapshots.before as DictionaryEntrySnapshot | undefined
      if (!before) return null
      const { translate } = await resolveTranslations()
      return {
        actionLabel: translate(`${translationKeyPrefix}.audit.delete`, fallbackDelete),
        resourceKind: config.resourceKind,
        resourceId: before.id,
        tenantId: before.tenantId,
        organizationId: before.organizationId,
        snapshotBefore: before,
        payload: {
          undo: { before } satisfies DictionaryEntryUndoPayload,
        },
      }
    },
    undo: async ({ logEntry, ctx }) => {
      const undo = extractUndoPayload<DictionaryEntryUndoPayload>(logEntry)
      const before =
        undo?.before ??
        (logEntry?.snapshotBefore as DictionaryEntrySnapshot | null | undefined) ??
        null
      if (!before) return
      const em = ctx.container.resolve<EntityManager>('em').fork()
      scopeEnsurer(ctx, { tenantId: before.tenantId, organizationId: before.organizationId })
      const dictionary = await ensureDictionaryForUndo({ em, ctx, snapshot: before })
      if (!dictionary) return
      let entry = await em.findOne(DictionaryEntry, before.id)
      if (!entry) {
        entry = em.create(DictionaryEntry, {
          id: before.id,
          dictionary,
          tenantId: before.tenantId,
          organizationId: before.organizationId,
          value: before.value,
          normalizedValue: normalizeDictionaryValue(before.value),
          label: before.label,
          color: before.color,
          icon: before.icon,
          createdAt: new Date(before.createdAt),
          updatedAt: new Date(before.updatedAt),
        })
        em.persist(entry)
      } else {
        entry.dictionary = dictionary
        applySnapshot(entry, before)
      }
      await em.flush()
    },
  }

  registerCommand(createCommand)
  registerCommand(updateCommand)
  registerCommand(deleteCommand)
}
