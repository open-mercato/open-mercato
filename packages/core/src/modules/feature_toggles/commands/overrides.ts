import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { LockMode } from '@mikro-orm/core'
import { FeatureToggle } from '../data/entities'
import { ProcessedChangeOverrideStateInput, processedChangeOverrideStateSchema } from '../data/validators'
import { FeatureToggleOverride } from '../data/entities'
import { buildChanges } from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { resolveRedoSnapshot } from '@open-mercato/shared/lib/commands/redo'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { FeatureTogglesService } from '../lib/feature-flag-check'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { badRequest, conflict, CrudHttpError, isUniqueViolation, notFound } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

type OverrideSnapshot = {
  id: string | null
  toggleId: string
  tenantId: string
  value?: any
  updatedAt: string | null
}

type OverrideUndoPayload = {
  before?: OverrideSnapshot
  after?: OverrideSnapshot
}

async function loadOverrideSnapshot(em: EntityManager, toggleId: string, tenantId: string): Promise<OverrideSnapshot | null> {
  const record = await em.findOne(FeatureToggleOverride, { toggle: toggleId, tenantId })
  if (!record) {
    return {
      id: null,
      toggleId: toggleId,
      tenantId: tenantId,
      value: undefined,
      updatedAt: null,
    }
  }

  return {
    id: record.id ?? null,
    toggleId: record.toggle.id,
    tenantId: record.tenantId,
    value: record.value,
    updatedAt: record.updatedAt ? record.updatedAt.toISOString() : null,
  }
}

async function throwOverrideUndoConflict(): Promise<never> {
  const { translate } = await resolveTranslations()
  throw new CrudHttpError(409, {
    error: translate(
      'feature_toggles.errors.overrideUndoConflict',
      'This override changed since the action you are undoing. Undo was refused.',
    ),
    code: 'feature_toggles.errors.overrideUndoConflict',
  })
}

async function throwOverrideRedoConflict(): Promise<never> {
  const { translate } = await resolveTranslations()
  throw conflict(translate(
    'feature_toggles.errors.overrideRedoConflict',
    'An override already exists for this feature toggle. Redo was refused.',
  ))
}

const changeOverrideStateCommand: CommandHandler<ProcessedChangeOverrideStateInput, { overrideToggleId: string | null }> = {
  id: 'feature_toggles.overrides.changeState',
  async prepare(rawInput, ctx) {
    const input = processedChangeOverrideStateSchema.parse(rawInput)
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadOverrideSnapshot(em, input.toggleId, input.tenantId)
    const result = snapshot ? { before: snapshot } : {}
    return result
  },
  async execute(rawInput, ctx) {
    const input = processedChangeOverrideStateSchema.parse(rawInput)
    const em = ctx.container.resolve('em') as EntityManager
    const toggle = await em.findOne(FeatureToggle, { id: input.toggleId, deletedAt: null })
    if (!toggle) {
      throw new CrudHttpError(404, { error: 'Feature toggle not found' })
    }
    if (!input.isOverride) {
      await em.nativeDelete(FeatureToggleOverride, { toggle: input.toggleId, tenantId: input.tenantId })
      await em.flush()
      const featureTogglesService = ctx.container.resolve('featureTogglesService') as FeatureTogglesService
      await featureTogglesService.invalidateIsEnabledCacheByKey(toggle.identifier, input.tenantId)
      return { overrideToggleId: null }
    }

    let override = await em.findOne(FeatureToggleOverride, { toggle: input.toggleId, tenantId: input.tenantId })
    if (override) {
      override.value = input.overrideValue
      await em.flush()
      const featureTogglesService = ctx.container.resolve('featureTogglesService') as FeatureTogglesService
      await featureTogglesService.invalidateIsEnabledCacheByKey(override.toggle.identifier, input.tenantId)
      return { overrideToggleId: override.id }
    }

    override = await em.create(FeatureToggleOverride, {
      toggle,
      tenantId: input.tenantId,
      value: input.overrideValue
    })
    await em.flush()
    const featureTogglesService = ctx.container.resolve('featureTogglesService') as FeatureTogglesService
    await featureTogglesService.invalidateIsEnabledCacheByKey(override.toggle.identifier, input.tenantId)
    return { overrideToggleId: override.id }
  },
  buildLog: async ({ snapshots, ctx }) => {
    const before = snapshots.before as OverrideSnapshot | undefined
    if (!before) return null
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const after = await loadOverrideSnapshot(em, before.toggleId, before.tenantId)
    if (!after) return null

    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('feature_toggles.audit.overrides.changeState', 'Change override state'),
      resourceKind: 'feature_toggles.overrides',
      resourceId: before.id ?? after.id,
      snapshotBefore: before,
      snapshotAfter: after,
      tenantId: before.tenantId,
      changes: buildChanges(
        before as unknown as Record<string, unknown>,
        after as unknown as Record<string, unknown>,
        ['value'],
      ),
      payload: {
        undo: {
          before,
          after,
        } satisfies OverrideUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<OverrideUndoPayload>(logEntry)
    const before = payload?.before
    const after = payload?.after

    if (!before) return

    const em = (ctx.container.resolve('em') as EntityManager).fork()

    await withAtomicFlush(em, [
      async () => {
        const existing = await em.findOne(
          FeatureToggleOverride,
          { toggle: before.toggleId, tenantId: before.tenantId },
          { lockMode: LockMode.PESSIMISTIC_WRITE },
        )
        const currentId = existing?.id ?? null
        const currentUpdatedAt = existing?.updatedAt ? existing.updatedAt.toISOString() : null
        const expectedId = after?.id ?? null
        const expectedUpdatedAt = after?.updatedAt ?? null
        if (currentId !== expectedId || currentUpdatedAt !== expectedUpdatedAt) {
          await throwOverrideUndoConflict()
        }

        if (!before.id) {
          await em.nativeDelete(FeatureToggleOverride, { toggle: before.toggleId, tenantId: before.tenantId })
        } else if (existing) {
          existing.value = before.value
        } else {
          em.create(FeatureToggleOverride, {
            id: before.id,
            toggle: before.toggleId,
            tenantId: before.tenantId,
            value: before.value ?? {},
          })
        }
      },
    ], { transaction: true, label: 'feature_toggles.overrides.changeState.undo' })

    const toggle = await findOneWithDecryption(em, FeatureToggle, { id: before.toggleId })
    if (toggle) {
      const featureTogglesService = ctx.container.resolve('featureTogglesService') as FeatureTogglesService
      await featureTogglesService.invalidateIsEnabledCacheByKey(toggle.identifier, before.tenantId)
    }
  },
  redo: async ({ input: rawInput, logEntry, ctx }) => {
    const input = processedChangeOverrideStateSchema.parse(rawInput)
    const before = extractUndoPayload<OverrideUndoPayload>(logEntry)?.before
    if (!input.isOverride || before?.id !== null) return changeOverrideStateCommand.execute(input, ctx)

    const after = resolveRedoSnapshot<OverrideSnapshot>(logEntry)
    if (!after?.id || after.toggleId !== input.toggleId || after.tenantId !== input.tenantId) {
      throw badRequest('[internal] invalid redo snapshot for override creation')
    }

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const toggle = await findOneWithDecryption(em, FeatureToggle, { id: after.toggleId, deletedAt: null })
    if (!toggle) {
      const { translate } = await resolveTranslations()
      throw notFound(translate('api.errors.notFound', 'Not Found'))
    }

    const existing = await findOneWithDecryption(em, FeatureToggleOverride, { toggle: after.toggleId, tenantId: after.tenantId }, undefined, { tenantId: after.tenantId })
    if (existing) await throwOverrideRedoConflict()

    const override = em.create(FeatureToggleOverride, {
      id: after.id,
      toggle,
      tenantId: after.tenantId,
      value: after.value,
    })
    try {
      await em.flush()
    } catch (error) {
      if (isUniqueViolation(error)) await throwOverrideRedoConflict()
      throw error
    }
    const featureTogglesService = ctx.container.resolve('featureTogglesService') as FeatureTogglesService
    await featureTogglesService.invalidateIsEnabledCacheByKey(toggle.identifier, after.tenantId)
    return { overrideToggleId: override.id }
  },
}

registerCommand(changeOverrideStateCommand)
