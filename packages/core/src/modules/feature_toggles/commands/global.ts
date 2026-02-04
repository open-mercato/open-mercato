import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { FeatureToggle, FeatureToggleOverride } from '../data/entities'
import { ToggleCreateInput, toggleCreateSchema, ToggleUpdateInput, toggleUpdateSchema } from '../data/validators'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { buildChanges, requireId } from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload } from '../../customers/commands/shared'
import { FeatureTogglesService } from '../lib/feature-flag-check'

type ToggleSnapshot = {
  id: string
  identifier: string
  name: string
  description: string | null
  category: string | null
  type: 'boolean' | 'string' | 'number' | 'json'
  defaultValue: any
}

type OverrideSnapshot = {
  id: string
  toggleId: string
  tenantId: string
  value?: any
}

type ToggleUndoPayload = {
  after?: ToggleSnapshot | null
  before?: ToggleSnapshot | null
  overrides?: OverrideSnapshot[]
}

async function loadToggleSnapshot(em: EntityManager, id: string): Promise<ToggleSnapshot | null> {
  const toggle = await em.findOne(FeatureToggle, { id })
  if (!toggle) return null
  return {
    id: toggle.id,
    identifier: toggle.identifier,
    name: toggle.name,
    description: toggle.description ?? null,
    category: toggle.category ?? null,
    type: toggle.type ?? 'boolean',
    defaultValue: toggle.defaultValue ?? null,
  }
}

async function loadOverrideSnapshots(em: EntityManager, toggleId: string): Promise<OverrideSnapshot[]> {
  const overrides = await em.find(FeatureToggleOverride, { toggle: toggleId })
  return overrides.map(o => ({
    id: o.id,
    toggleId: o.toggle.id,
    tenantId: o.tenantId,
    value: o.value,
  }))
}

const createToggleCommand: CommandHandler<ToggleCreateInput, { toggleId: string }> = {
  id: 'feature_toggles.global.create',
  async execute(rawInput, ctx) {
    const parsed = toggleCreateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const toggle = em.create(FeatureToggle, {
      identifier: parsed.identifier,
      name: parsed.name,
      description: parsed.description,
      category: parsed.category,
      type: parsed.type,
      defaultValue: parsed.defaultValue,
    })
    em.persist(toggle)
    await em.flush()

    return { toggleId: toggle.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadToggleSnapshot(em, result.toggleId)
  },
  buildLog: async ({ result, ctx }) => {
    const { translate } = await resolveTranslations()
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadToggleSnapshot(em, result.toggleId)
    return {
      actionLabel: translate('feature_toggles.audit.toggles.create', 'Create toggle'),
      resourceKind: 'feature_toggles.global',
      resourceId: result.toggleId,
      snapshotAfter: snapshot ?? null,
      payload: {
        undo: {
          after: snapshot ?? null,
        } satisfies ToggleUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const toggleId = logEntry?.resourceId ?? null
    if (!toggleId) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const overrides = await em.find(FeatureToggleOverride, { toggle: toggleId })
    if (overrides.length > 0) {
      em.remove(overrides)
    }
    const toggle = await em.findOne(FeatureToggle, { id: toggleId })
    if (toggle) {
      em.remove(toggle)
      await em.flush()
      const featureTogglesService = ctx.container.resolve('featureTogglesService') as FeatureTogglesService
      await featureTogglesService.invalidateIsEnabledCacheByIdentifierTag(toggle.identifier)
    }
  }
}

const updateToggleCommand: CommandHandler<ToggleUpdateInput, { toggleId: string }> = {
  id: 'feature_toggles.global.update',
  async prepare(rawInput, ctx) {
    const parsed = toggleUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadToggleSnapshot(em, parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = toggleUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const toggle = await em.findOne(FeatureToggle, { id: parsed.id })
    if (!toggle) throw new CrudHttpError(404, { error: 'Toggle not found' })
    toggle.identifier = parsed.identifier ?? toggle.identifier
    toggle.name = parsed.name ?? toggle.name
    toggle.description = parsed.description ?? toggle.description
    toggle.category = parsed.category ?? toggle.category
    toggle.type = parsed.type ?? toggle.type
    toggle.defaultValue = parsed.defaultValue ?? toggle.defaultValue
    await em.flush()
    const featureTogglesService = ctx.container.resolve('featureTogglesService') as FeatureTogglesService
    await featureTogglesService.invalidateIsEnabledCacheByIdentifierTag(toggle.identifier)
    return { toggleId: toggle.id }
  },
  buildLog: async ({ snapshots, ctx }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as ToggleSnapshot | undefined
    if (!before) return null
    const em = (ctx.container.resolve('em') as EntityManager).fork().fork()
    const afterSnapshot = await loadToggleSnapshot(em, before.id)
    const changes =
      afterSnapshot && before
        ? buildChanges(
          before as unknown as Record<string, unknown>,
          afterSnapshot as unknown as Record<string, unknown>,
          [
            'identifier',
            'name',
            'description',
            'category',
            'failMode',
            'type',
            'defaultValue',
          ]
        )
        : {}

    return {
      actionLabel: translate('feature_toggles.audit.toggles.update', 'Update toggle'),
      resourceKind: 'feature_toggles.global',
      resourceId: before.id,
      snapshotBefore: before,
      snapshotAfter: afterSnapshot ?? null,
      changes,
      payload: {
        undo: {
          before,
          after: afterSnapshot ?? null,
        } satisfies ToggleUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ToggleUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let toggle = await em.findOne(FeatureToggle, { id: before.id })
    if (!toggle) {
      toggle = em.create(FeatureToggle, {
        id: before.id,
        identifier: before.identifier,
        name: before.name,
        description: before.description,
        category: before.category,
        type: before.type,
        defaultValue: before.defaultValue,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(toggle)
    } else {
      toggle.identifier = before.identifier
      toggle.name = before.name
      toggle.description = before.description
      toggle.category = before.category
    }
    await em.flush()
    const featureTogglesService = ctx.container.resolve('featureTogglesService') as FeatureTogglesService
    await featureTogglesService.invalidateIsEnabledCacheByIdentifierTag(toggle.identifier)
  }
}

const deleteToggleCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, { toggleId: string }> =
{
  id: 'feature_toggles.global.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'Feature toggle id required')
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadToggleSnapshot(em, id)
    const overrides = await loadOverrideSnapshots(em, id)
    return snapshot ? { before: snapshot, overrides } : {}
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Feature toggle id required')
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const toggle = await em.findOne(FeatureToggle, { id })
    if (!toggle) throw new CrudHttpError(404, { error: 'Feature toggle not found' })
    const featureTogglesService = ctx.container.resolve('featureTogglesService') as FeatureTogglesService
    await featureTogglesService.invalidateIsEnabledCacheByIdentifierTag(toggle.identifier)

    const overrides = await em.find(FeatureToggleOverride, { toggle: toggle.id })
    if (overrides.length > 0) {
      em.remove(overrides)
    }

    em.remove(toggle)
    await em.flush()

    return { toggleId: toggle.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as ToggleSnapshot | undefined
    const overrides = (snapshots as any).overrides as OverrideSnapshot[] | undefined

    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('feature_toggles.audit.toggles.delete', 'Delete toggle'),
      resourceKind: 'feature_toggles.global',
      resourceId: before.id,
      snapshotBefore: before,
      payload: {
        undo: {
          before,
          overrides,
        } satisfies ToggleUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ToggleUndoPayload>(logEntry)
    const before = payload?.before
    const overrides = payload?.overrides || []

    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let toggle = await em.findOne(FeatureToggle, { id: before.id })
    if (!toggle) {
      toggle = em.create(FeatureToggle, {
        id: before.id,
        identifier: before.identifier,
        name: before.name,
        description: before.description,
        category: before.category,
        type: before.type,
        defaultValue: before.defaultValue,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(toggle)

      for (const ov of overrides) {
        const override = em.create(FeatureToggleOverride, {
          id: ov.id,
          toggle: toggle,
          tenantId: ov.tenantId,
          value: ov.value ?? null,
        })
        em.persist(override)
      }
    } else {
      toggle.identifier = before.identifier
      toggle.name = before.name
      toggle.description = before.description
      toggle.category = before.category
    }
    const featureTogglesService = ctx.container.resolve('featureTogglesService') as FeatureTogglesService
    await featureTogglesService.invalidateIsEnabledCacheByIdentifierTag(toggle.identifier)
    await em.flush()
  },
}

registerCommand(createToggleCommand)
registerCommand(updateToggleCommand)
registerCommand(deleteToggleCommand)