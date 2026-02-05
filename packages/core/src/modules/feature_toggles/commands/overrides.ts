import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager, JsonType } from '@mikro-orm/postgresql'
import { FeatureToggle } from '../data/entities'
import { ProcessedChangeOverrideStateInput, processedChangeOverrideStateSchema } from '../data/validators'
import { FeatureToggleOverride } from '../data/entities'
import { buildChanges } from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { FeatureTogglesService } from '../lib/feature-flag-check'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

type OverrideSnapshot = {
  id: string | null
  toggleId: string
  tenantId: string
  value?: any
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
    }
  }

  return {
    id: record.id ?? null,
    toggleId: record.toggle.id,
    tenantId: record.tenantId,
    value: record.value,
  }
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
    if (!input.isOverride) {
      await em.nativeDelete(FeatureToggleOverride, { toggle: input.toggleId, tenantId: input.tenantId })
      await em.flush()
      const toggle = await em.findOne(FeatureToggle, { id: input.toggleId })
      if (toggle) {
        const featureTogglesService = ctx.container.resolve('featureTogglesService') as FeatureTogglesService
        await featureTogglesService.invalidateIsEnabledCacheByKey(toggle.identifier, input.tenantId)
      }
      return { overrideToggleId: null }
    }

    let override = await em.findOne(FeatureToggleOverride, { toggle: input.toggleId, tenantId: input.tenantId })
    if (override) {
      override.value = input.overrideValue as JsonType
      await em.flush()
      const featureTogglesService = ctx.container.resolve('featureTogglesService') as FeatureTogglesService
      await featureTogglesService.invalidateIsEnabledCacheByKey(override.toggle.identifier, input.tenantId)
      return { overrideToggleId: override.id }
    }

    override = await em.create(FeatureToggleOverride, {
      toggle: input.toggleId,
      tenantId: input.tenantId,
      value: input.overrideValue as JsonType
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
      resourceId: before.id,
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

    if (!before) return

    const em = (ctx.container.resolve('em') as EntityManager).fork()

    if (!before.id) {
      await em.nativeDelete(FeatureToggleOverride, { toggle: before.toggleId, tenantId: before.tenantId })
      await em.flush()
      const toggle = await em.findOne(FeatureToggle, { id: before.toggleId })
      if (toggle) {
        const featureTogglesService = ctx.container.resolve('featureTogglesService') as FeatureTogglesService
        await featureTogglesService.invalidateIsEnabledCacheByKey(toggle.identifier, before.tenantId)
      }
    } else {
      const existing = await em.findOne(FeatureToggleOverride, { toggle: before.toggleId, tenantId: before.tenantId })
      if (existing) {
        await em.flush()
        const featureTogglesService = ctx.container.resolve('featureTogglesService') as FeatureTogglesService
        await featureTogglesService.invalidateIsEnabledCacheByKey(existing.toggle.identifier, existing.tenantId)
      } else {
        const override = em.create(FeatureToggleOverride, {
          toggle: before.toggleId,
          tenantId: before.tenantId,
          value: before.value ?? {},
        })
        await em.flush()
        const featureTogglesService = ctx.container.resolve('featureTogglesService') as FeatureTogglesService
        await featureTogglesService.invalidateIsEnabledCacheByKey(override.toggle.identifier, override.tenantId)
      }
    }
  },
}

registerCommand(changeOverrideStateCommand)
