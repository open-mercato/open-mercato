import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { buildChanges } from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { invalidateDictionaryCache } from '../api/dictionaries/cache'
import type { CacheStrategy } from '@open-mercato/cache'
import {
  customerDictionaryEntryCreateSchema,
  customerDictionaryEntryDeleteSchema,
  customerDictionaryEntryUpdateSchema,
  type CustomerDictionaryEntryCreateInput,
  type CustomerDictionaryEntryDeleteInput,
  type CustomerDictionaryEntryUpdateInput,
} from '../data/validators'
import { CustomerDictionaryEntry } from '../data/entities'
import {
  ensureOrganizationScope,
  ensureTenantScope,
  extractUndoPayload,
  normalizeDictionaryColor,
  normalizeDictionaryIcon,
} from './shared'

type CustomerDictionaryEntrySnapshot = {
  id: string
  tenantId: string
  organizationId: string
  kind: string
  value: string
  normalizedValue: string
  label: string
  color: string | null
  icon: string | null
}

type CustomerDictionaryEntryUndoPayload = {
  before?: CustomerDictionaryEntrySnapshot | null
  after?: CustomerDictionaryEntrySnapshot | null
}

function normalizeValue(input: string): { value: string; normalized: string } {
  const trimmed = input.trim()
  if (!trimmed) {
    throw new CrudHttpError(400, { error: 'Dictionary entry value is required' })
  }
  return { value: trimmed, normalized: trimmed.toLowerCase() }
}

function sanitizeColor(input: string | null | undefined): string | null | undefined {
  if (input === undefined) return undefined
  if (input === null) return null
  return normalizeDictionaryColor(input)
}

function sanitizeIcon(input: string | null | undefined): string | null | undefined {
  if (input === undefined) return undefined
  if (input === null) return null
  return normalizeDictionaryIcon(input)
}

function toSnapshot(entry: CustomerDictionaryEntry): CustomerDictionaryEntrySnapshot {
  return {
    id: entry.id,
    tenantId: entry.tenantId,
    organizationId: entry.organizationId,
    kind: entry.kind,
    value: entry.value,
    normalizedValue: entry.normalizedValue,
    label: entry.label,
    color: entry.color ?? null,
    icon: entry.icon ?? null,
  }
}

async function loadSnapshot(em: EntityManager, id: string): Promise<CustomerDictionaryEntrySnapshot | null> {
  const entry = await em.findOne(CustomerDictionaryEntry, { id })
  return entry ? toSnapshot(entry) : null
}

function applySnapshot(entry: CustomerDictionaryEntry, snapshot: CustomerDictionaryEntrySnapshot): void {
  entry.tenantId = snapshot.tenantId
  entry.organizationId = snapshot.organizationId
  entry.kind = snapshot.kind
  entry.value = snapshot.value
  entry.normalizedValue = snapshot.normalizedValue
  entry.label = snapshot.label
  entry.color = snapshot.color
  entry.icon = snapshot.icon
}

async function invalidateCache(
  ctx: CommandRuntimeContext,
  snapshot: CustomerDictionaryEntrySnapshot | null | undefined
) {
  if (!snapshot) return
  let cache: CacheStrategy | undefined
  try {
    cache = ctx.container.resolve<CacheStrategy>('cache')
  } catch {
    cache = undefined
  }
  if (!cache) return
  await invalidateDictionaryCache(cache, {
    tenantId: snapshot.tenantId,
    mappedKind: snapshot.kind,
    organizationIds: [snapshot.organizationId],
  })
}

type CreateResult = {
  entryId: string
  mode: 'created' | 'updated' | 'unchanged'
  before?: CustomerDictionaryEntrySnapshot | null
}

const createDictionaryEntryCommand: CommandHandler<CustomerDictionaryEntryCreateInput, CreateResult> = {
  id: 'customers.dictionaryEntries.create',
  async execute(rawInput, ctx) {
    const parsed = customerDictionaryEntryCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = ctx.container.resolve<EntityManager>('em').fork()
    const value = normalizeValue(parsed.value)
    const label = parsed.label?.trim() || value.value
    const color = sanitizeColor(parsed.color)
    const icon = sanitizeIcon(parsed.icon)

    const existing = await em.findOne(CustomerDictionaryEntry, {
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      kind: parsed.kind,
      normalizedValue: value.normalized,
    })

    if (existing) {
      const before = toSnapshot(existing)
      let changed = false

      if (parsed.label !== undefined && existing.label !== label) {
        existing.label = label
        changed = true
      }
      if (color !== undefined && existing.color !== color) {
        existing.color = color ?? null
        changed = true
      }
      if (icon !== undefined && existing.icon !== icon) {
        existing.icon = icon ?? null
        changed = true
      }

      if (changed) {
        existing.updatedAt = new Date()
        await em.flush()
        return { entryId: existing.id, mode: 'updated', before }
      }

      return { entryId: existing.id, mode: 'unchanged', before }
    }

    const entry = em.create(CustomerDictionaryEntry, {
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      kind: parsed.kind,
      value: value.value,
      normalizedValue: value.normalized,
      label,
      color: color ?? null,
      icon: icon ?? null,
    })
    em.persist(entry)
    await em.flush()

    return { entryId: entry.id, mode: 'created' }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve<EntityManager>('em')
    return loadSnapshot(em, result.entryId)
  },
  buildLog: async ({ result, snapshots }) => {
    const after = snapshots.after as CustomerDictionaryEntrySnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()

    if (result.mode === 'created') {
      return {
        actionLabel: translate('customers.audit.dictionaryEntries.create', 'Add dictionary entry'),
        resourceKind: 'customers.dictionary_entry',
        resourceId: after.id,
        tenantId: after.tenantId,
        organizationId: after.organizationId,
        snapshotAfter: after,
        payload: {
          undo: { after } satisfies CustomerDictionaryEntryUndoPayload,
        },
      }
    }

    if (result.mode === 'updated') {
      const before = result.before ?? null
      if (!before) return null
      const changes = buildChanges(
        before as unknown as Record<string, unknown>,
        after as unknown as Record<string, unknown>,
        ['label', 'color', 'icon']
      )
      if (!changes || Object.keys(changes).length === 0) return null
      return {
        actionLabel: translate('customers.audit.dictionaryEntries.update', 'Update dictionary entry'),
        resourceKind: 'customers.dictionary_entry',
        resourceId: after.id,
        tenantId: after.tenantId,
        organizationId: after.organizationId,
        snapshotBefore: before,
        snapshotAfter: after,
        changes,
        payload: {
          undo: { before, after } satisfies CustomerDictionaryEntryUndoPayload,
        },
      }
    }

    return null
  },
  undo: async ({ logEntry, ctx }) => {
    const undo = extractUndoPayload<CustomerDictionaryEntryUndoPayload>(logEntry)
    if (!undo) return
    const em = ctx.container.resolve<EntityManager>('em').fork()

    const after =
      undo.after ??
      (logEntry?.snapshotAfter as CustomerDictionaryEntrySnapshot | null | undefined) ??
      null

    if (after && !undo.before) {
      ensureTenantScope(ctx, after.tenantId)
      ensureOrganizationScope(ctx, after.organizationId)
      const entry = await em.findOne(CustomerDictionaryEntry, { id: after.id })
      if (entry) {
        await em.removeAndFlush(entry)
        await invalidateCache(ctx, after)
        return
      }
      await em.nativeDelete(CustomerDictionaryEntry, { id: after.id })
      await invalidateCache(ctx, after)
      return
    }

    const before =
      undo.before ??
      (logEntry?.snapshotBefore as CustomerDictionaryEntrySnapshot | null | undefined) ??
      null

    if (before) {
      ensureTenantScope(ctx, before.tenantId)
      ensureOrganizationScope(ctx, before.organizationId)
      let entry = await em.findOne(CustomerDictionaryEntry, { id: before.id })
      if (!entry) {
        entry = em.create(CustomerDictionaryEntry, {
          id: before.id,
          tenantId: before.tenantId,
          organizationId: before.organizationId,
          kind: before.kind,
          value: before.value,
          normalizedValue: before.normalizedValue,
          label: before.label,
          color: before.color,
          icon: before.icon,
        })
        em.persist(entry)
      } else {
        applySnapshot(entry, before)
      }
      await em.flush()
      await invalidateCache(ctx, before)
    }
  },
}

type UpdateResult = {
  entryId: string
  changed: boolean
}

const updateDictionaryEntryCommand: CommandHandler<CustomerDictionaryEntryUpdateInput, UpdateResult> = {
  id: 'customers.dictionaryEntries.update',
  async prepare(rawInput, ctx) {
    const parsed = customerDictionaryEntryUpdateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const em = ctx.container.resolve<EntityManager>('em')
    const snapshot = await loadSnapshot(em, parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = customerDictionaryEntryUpdateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = ctx.container.resolve<EntityManager>('em').fork()
    const entry = await em.findOne(CustomerDictionaryEntry, { id: parsed.id })
    if (!entry || entry.organizationId !== parsed.organizationId || entry.tenantId !== parsed.tenantId || entry.kind !== parsed.kind) {
      throw new CrudHttpError(404, { error: 'Dictionary entry not found' })
    }

    let changed = false

    if (parsed.value !== undefined) {
      const value = normalizeValue(parsed.value)
      if (value.normalized !== entry.normalizedValue) {
        const duplicate = await em.findOne(CustomerDictionaryEntry, {
          id: { $ne: entry.id },
          tenantId: parsed.tenantId,
          organizationId: parsed.organizationId,
          kind: parsed.kind,
          normalizedValue: value.normalized,
        })
        if (duplicate) {
          throw new CrudHttpError(409, { error: 'An entry with this value already exists' })
        }
        entry.value = value.value
        entry.normalizedValue = value.normalized
        if (parsed.label === undefined) {
          entry.label = value.value
        }
        changed = true
      }
    }

    if (parsed.label !== undefined) {
      const label = parsed.label.trim() || entry.value
      if (entry.label !== label) {
        entry.label = label
        changed = true
      }
    }

    if (parsed.color !== undefined) {
      const color = sanitizeColor(parsed.color)
      if (entry.color !== (color ?? null)) {
        entry.color = color ?? null
        changed = true
      }
    }

    if (parsed.icon !== undefined) {
      const icon = sanitizeIcon(parsed.icon)
      if (entry.icon !== (icon ?? null)) {
        entry.icon = icon ?? null
        changed = true
      }
    }

    if (changed) {
      entry.updatedAt = new Date()
      await em.flush()
    }

    return { entryId: entry.id, changed }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve<EntityManager>('em')
    return loadSnapshot(em, result.entryId)
  },
  buildLog: async ({ snapshots, result }) => {
    const before = snapshots.before as CustomerDictionaryEntrySnapshot | undefined
    const after = snapshots.after as CustomerDictionaryEntrySnapshot | undefined
    if (!before || !after || !result.changed) return null
    const changes = buildChanges(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>,
      ['value', 'label', 'color', 'icon']
    )
    if (!changes || Object.keys(changes).length === 0) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('customers.audit.dictionaryEntries.update', 'Update dictionary entry'),
      resourceKind: 'customers.dictionary_entry',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      changes,
      payload: {
        undo: { before, after } satisfies CustomerDictionaryEntryUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const undo = extractUndoPayload<CustomerDictionaryEntryUndoPayload>(logEntry)
    const before =
      undo?.before ??
      (logEntry?.snapshotBefore as CustomerDictionaryEntrySnapshot | null | undefined) ??
      null
    if (!before) return
    ensureTenantScope(ctx, before.tenantId)
    ensureOrganizationScope(ctx, before.organizationId)
    const em = ctx.container.resolve<EntityManager>('em').fork()
    let entry = await em.findOne(CustomerDictionaryEntry, { id: before.id })
    if (!entry) {
      entry = em.create(CustomerDictionaryEntry, {
        id: before.id,
        tenantId: before.tenantId,
        organizationId: before.organizationId,
        kind: before.kind,
        value: before.value,
        normalizedValue: before.normalizedValue,
        label: before.label,
        color: before.color,
        icon: before.icon,
      })
      em.persist(entry)
    } else {
      applySnapshot(entry, before)
    }
    await em.flush()
    await invalidateCache(ctx, before)
  },
}

const deleteDictionaryEntryCommand: CommandHandler<CustomerDictionaryEntryDeleteInput, { entryId: string }> = {
  id: 'customers.dictionaryEntries.delete',
  async prepare(rawInput, ctx) {
    const parsed = customerDictionaryEntryDeleteSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const em = ctx.container.resolve<EntityManager>('em')
    const snapshot = await loadSnapshot(em, parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = customerDictionaryEntryDeleteSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = ctx.container.resolve<EntityManager>('em').fork()
    const entry = await em.findOne(CustomerDictionaryEntry, { id: parsed.id })
    if (!entry || entry.organizationId !== parsed.organizationId || entry.tenantId !== parsed.tenantId || entry.kind !== parsed.kind) {
      throw new CrudHttpError(404, { error: 'Dictionary entry not found' })
    }
    em.remove(entry)
    await em.flush()
    return { entryId: entry.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as CustomerDictionaryEntrySnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('customers.audit.dictionaryEntries.delete', 'Delete dictionary entry'),
      resourceKind: 'customers.dictionary_entry',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: { before } satisfies CustomerDictionaryEntryUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const undo = extractUndoPayload<CustomerDictionaryEntryUndoPayload>(logEntry)
    const before =
      undo?.before ??
      (logEntry?.snapshotBefore as CustomerDictionaryEntrySnapshot | null | undefined) ??
      null
    if (!before) return
    ensureTenantScope(ctx, before.tenantId)
    ensureOrganizationScope(ctx, before.organizationId)
    const em = ctx.container.resolve<EntityManager>('em').fork()
    let entry = await em.findOne(CustomerDictionaryEntry, { id: before.id })
    if (!entry) {
      entry = em.create(CustomerDictionaryEntry, {
        id: before.id,
        tenantId: before.tenantId,
        organizationId: before.organizationId,
        kind: before.kind,
        value: before.value,
        normalizedValue: before.normalizedValue,
        label: before.label,
        color: before.color,
        icon: before.icon,
      })
      em.persist(entry)
    } else {
      applySnapshot(entry, before)
    }
    await em.flush()
    await invalidateCache(ctx, before)
  },
}

registerCommand(createDictionaryEntryCommand)
registerCommand(updateDictionaryEntryCommand)
registerCommand(deleteDictionaryEntryCommand)
