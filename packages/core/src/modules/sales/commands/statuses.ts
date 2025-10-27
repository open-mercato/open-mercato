import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { buildChanges, requireId } from '@open-mercato/shared/lib/commands/helpers'
import type { EntityManager } from '@mikro-orm/postgresql'
import { DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  ensureSalesDictionary,
  getSalesDictionaryDefinition,
  normalizeDictionaryValue,
  sanitizeDictionaryColor,
  sanitizeDictionaryIcon,
  type SalesDictionaryKind,
} from '../lib/dictionaries'
import {
  ensureOrganizationScope,
  ensureTenantScope,
  extractUndoPayload,
} from './shared'
import {
  statusDictionaryCreateSchema,
  statusDictionaryUpdateSchema,
} from '../data/validators'

type StatusSnapshot = {
  id: string
  dictionaryId: string
  dictionaryKey: string
  organizationId: string
  tenantId: string
  value: string
  label: string
  color: string | null
  icon: string | null
}

type StatusUndoPayload = {
  before?: StatusSnapshot | null
  after?: StatusSnapshot | null
}

async function loadStatusSnapshot(em: EntityManager, id: string): Promise<StatusSnapshot | null> {
  const entry = await em.findOne(DictionaryEntry, id, { populate: ['dictionary'] })
  if (!entry) return null
  const dictionary = entry.dictionary
  return {
    id: entry.id,
    dictionaryId: dictionary.id,
    dictionaryKey: dictionary.key,
    organizationId: entry.organizationId,
    tenantId: entry.tenantId,
    value: entry.value,
    label: entry.label,
    color: entry.color ?? null,
    icon: entry.icon ?? null,
  }
}

function applyStatusSnapshot(entry: DictionaryEntry, snapshot: StatusSnapshot): void {
  entry.value = snapshot.value
  entry.normalizedValue = normalizeDictionaryValue(snapshot.value)
  entry.label = snapshot.label
  entry.color = snapshot.color ?? null
  entry.icon = snapshot.icon ?? null
  entry.organizationId = snapshot.organizationId
  entry.tenantId = snapshot.tenantId
}

function buildStatusCommands(kind: SalesDictionaryKind) {
  const definition = getSalesDictionaryDefinition(kind)

  const createCommand: CommandHandler<
    ReturnType<typeof statusDictionaryCreateSchema['parse']>,
    { entryId: string }
  > = {
    id: `${definition.commandPrefix}.create`,
    async execute(rawInput, ctx) {
      const parsed = statusDictionaryCreateSchema.parse(rawInput)
      ensureTenantScope(ctx, parsed.tenantId)
      ensureOrganizationScope(ctx, parsed.organizationId)

      const em = ctx.container.resolve<EntityManager>('em').fork()
      const dictionary = await ensureSalesDictionary({
        em,
        tenantId: parsed.tenantId,
        organizationId: parsed.organizationId,
        kind,
      })

      const normalized = normalizeDictionaryValue(parsed.value)
      const duplicate = await em.findOne(DictionaryEntry, {
        dictionary,
        tenantId: parsed.tenantId,
        organizationId: parsed.organizationId,
        normalizedValue: normalized,
      })
      if (duplicate) {
        throw new CrudHttpError(409, { error: 'Value already exists in this dictionary.' })
      }

      const entry = em.create(DictionaryEntry, {
        dictionary,
        organizationId: parsed.organizationId,
        tenantId: parsed.tenantId,
        value: parsed.value.trim(),
        normalizedValue: normalized,
        label: (parsed.label ?? parsed.value).trim(),
        color: sanitizeDictionaryColor(parsed.color) ?? null,
        icon: sanitizeDictionaryIcon(parsed.icon) ?? null,
      })
      em.persist(entry)
      await em.flush()
      return { entryId: entry.id }
    },
    captureAfter: async (_input, result, ctx) => {
      const em = ctx.container.resolve<EntityManager>('em')
      return loadStatusSnapshot(em, result.entryId)
    },
    buildLog: async ({ result, snapshots }) => {
      const after = snapshots.after as StatusSnapshot | undefined
      if (!after) return null
      const { translate } = await resolveTranslations()
      return {
        actionLabel: translate(`${definition.commandPrefix}.audit.create`, `Create ${definition.singular}`),
        resourceKind: definition.resourceKind,
        resourceId: result.entryId,
        tenantId: after.tenantId,
        organizationId: after.organizationId,
        snapshotAfter: after,
        payload: {
          undo: { after } satisfies StatusUndoPayload,
        },
      }
    },
    undo: async ({ logEntry, ctx }) => {
      const payload = extractUndoPayload<StatusUndoPayload>(logEntry)
      const after = payload?.after
      if (!after) return
      const em = ctx.container.resolve<EntityManager>('em').fork()
      const entry = await em.findOne(DictionaryEntry, after.id)
      if (!entry) return
      ensureTenantScope(ctx, entry.tenantId)
      ensureOrganizationScope(ctx, entry.organizationId)
      em.remove(entry)
      await em.flush()
    },
  }

  const updateCommand: CommandHandler<
    ReturnType<typeof statusDictionaryUpdateSchema['parse']>,
    { entryId: string }
  > = {
    id: `${definition.commandPrefix}.update`,
    async prepare(input, ctx) {
      const id = requireId(input, 'Dictionary entry id is required')
      const em = ctx.container.resolve<EntityManager>('em')
      const snapshot = await loadStatusSnapshot(em, id)
      if (snapshot) {
        if (snapshot.dictionaryKey !== definition.key) {
          throw new CrudHttpError(400, { error: 'Entry does not belong to this dictionary.' })
        }
        ensureTenantScope(ctx, snapshot.tenantId)
        ensureOrganizationScope(ctx, snapshot.organizationId)
      }
      return snapshot ? { before: snapshot } : {}
    },
    async execute(rawInput, ctx) {
      const parsed = statusDictionaryUpdateSchema.parse(rawInput)
      const em = ctx.container.resolve<EntityManager>('em').fork()
      const entry = await em.findOne(DictionaryEntry, parsed.id, { populate: ['dictionary'] })
      if (!entry) throw new CrudHttpError(404, { error: 'Dictionary entry not found' })
      if (entry.dictionary.key !== definition.key) {
        throw new CrudHttpError(400, { error: 'Entry does not belong to this dictionary.' })
      }
      ensureTenantScope(ctx, entry.tenantId)
      ensureOrganizationScope(ctx, entry.organizationId)

      if (parsed.value !== undefined) {
        const value = parsed.value.trim()
        const normalized = normalizeDictionaryValue(value)
        if (normalized !== entry.normalizedValue) {
          const duplicate = await em.findOne(DictionaryEntry, {
            dictionary: entry.dictionary,
            tenantId: entry.tenantId,
            organizationId: entry.organizationId,
            normalizedValue: normalized,
            id: { $ne: entry.id },
          } as any)
          if (duplicate) {
            throw new CrudHttpError(409, { error: 'Value already exists in this dictionary.' })
          }
          entry.value = value
          entry.normalizedValue = normalized
        }
      }
      if (parsed.label !== undefined) entry.label = parsed.label?.trim() ?? entry.value
      if (parsed.color !== undefined) entry.color = sanitizeDictionaryColor(parsed.color)
      if (parsed.icon !== undefined) entry.icon = sanitizeDictionaryIcon(parsed.icon)
      await em.flush()
      return { entryId: entry.id }
    },
    captureAfter: async (_input, result, ctx) => {
      const em = ctx.container.resolve<EntityManager>('em')
      return loadStatusSnapshot(em, result.entryId)
    },
    buildLog: async ({ snapshots }) => {
      const before = snapshots.before as StatusSnapshot | undefined
      const after = snapshots.after as StatusSnapshot | undefined
      if (!before || !after) return null
      const { translate } = await resolveTranslations()
      return {
        actionLabel: translate(`${definition.commandPrefix}.audit.update`, `Update ${definition.singular}`),
        resourceKind: definition.resourceKind,
        resourceId: before.id,
        tenantId: before.tenantId,
        organizationId: before.organizationId,
        snapshotBefore: before,
        snapshotAfter: after,
        changes: buildChanges(before as Record<string, unknown>, after as Record<string, unknown>),
        payload: {
          undo: { before, after } satisfies StatusUndoPayload,
        },
      }
    },
    undo: async ({ logEntry, ctx }) => {
      const payload = extractUndoPayload<StatusUndoPayload>(logEntry)
      const before = payload?.before
      if (!before) return
      const em = ctx.container.resolve<EntityManager>('em').fork()
      let entry = await em.findOne(DictionaryEntry, before.id, { populate: ['dictionary'] })
      ensureTenantScope(ctx, before.tenantId)
      ensureOrganizationScope(ctx, before.organizationId)
      const dictionary = await ensureSalesDictionary({
        em,
        tenantId: before.tenantId,
        organizationId: before.organizationId,
        kind,
      })
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
        })
        em.persist(entry)
      } else {
        applyStatusSnapshot(entry, { ...before, dictionaryId: dictionary.id })
      }
      await em.flush()
    },
  }

  const deleteCommand: CommandHandler<
    { body?: Record<string, unknown>; query?: Record<string, unknown> },
    { entryId: string }
  > = {
    id: `${definition.commandPrefix}.delete`,
    async prepare(input, ctx) {
      const id = requireId(input, 'Dictionary entry id is required')
      const em = ctx.container.resolve<EntityManager>('em')
      const snapshot = await loadStatusSnapshot(em, id)
      if (snapshot) {
        if (snapshot.dictionaryKey !== definition.key) {
          throw new CrudHttpError(400, { error: 'Entry does not belong to this dictionary.' })
        }
        ensureTenantScope(ctx, snapshot.tenantId)
        ensureOrganizationScope(ctx, snapshot.organizationId)
      }
      return snapshot ? { before: snapshot } : {}
    },
    async execute(input, ctx) {
      const id = requireId(input, 'Dictionary entry id is required')
      const em = ctx.container.resolve<EntityManager>('em').fork()
      const entry = await em.findOne(DictionaryEntry, id, { populate: ['dictionary'] })
      if (!entry) throw new CrudHttpError(404, { error: 'Dictionary entry not found' })
      if (entry.dictionary.key !== definition.key) {
        throw new CrudHttpError(400, { error: 'Entry does not belong to this dictionary.' })
      }
      ensureTenantScope(ctx, entry.tenantId)
      ensureOrganizationScope(ctx, entry.organizationId)
      em.remove(entry)
      await em.flush()
      return { entryId: id }
    },
    buildLog: async ({ snapshots }) => {
      const before = snapshots.before as StatusSnapshot | undefined
      if (!before) return null
      const { translate } = await resolveTranslations()
      return {
        actionLabel: translate(`${definition.commandPrefix}.audit.delete`, `Delete ${definition.singular}`),
        resourceKind: definition.resourceKind,
        resourceId: before.id,
        tenantId: before.tenantId,
        organizationId: before.organizationId,
        snapshotBefore: before,
        payload: {
          undo: { before } satisfies StatusUndoPayload,
        },
      }
    },
    undo: async ({ logEntry, ctx }) => {
      const payload = extractUndoPayload<StatusUndoPayload>(logEntry)
      const before = payload?.before
      if (!before) return
      const em = ctx.container.resolve<EntityManager>('em').fork()
      ensureTenantScope(ctx, before.tenantId)
      ensureOrganizationScope(ctx, before.organizationId)
      const dictionary = await ensureSalesDictionary({
        em,
        tenantId: before.tenantId,
        organizationId: before.organizationId,
        kind,
      })
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
        })
        em.persist(entry)
      } else {
        applyStatusSnapshot(entry, { ...before, dictionaryId: dictionary.id })
      }
      await em.flush()
    },
  }

  registerCommand(createCommand)
  registerCommand(updateCommand)
  registerCommand(deleteCommand)
}

buildStatusCommands('order-status')
buildStatusCommands('order-line-status')
