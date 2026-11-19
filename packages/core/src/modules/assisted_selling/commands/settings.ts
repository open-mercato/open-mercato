import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { buildOptimisticLockConflictBody } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { isUniqueViolation } from '@open-mercato/shared/lib/db/pg-errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { AssistedSellingStoreSettings } from '../data/entities'
import {
  assistedSellingStoreSettingsSaveSchema,
  type AssistedSellingStoreSettingsSaveInput,
} from '../data/validators'
import {
  ASSISTED_SELLING_STORE_SETTINGS_DEFAULTS,
  loadAssistedSellingStoreSettings,
  toEffectiveAssistedSellingSettings,
  type AssistedSellingEffectiveSettings,
} from '../lib/settings'
import {
  ASSISTED_SELLING_STORE_SETTINGS_RESOURCE_KIND,
  enforceAssistedSellingOptimisticLock,
  ensureOrganizationScope,
  ensureTenantScope,
} from './shared'

export type SaveAssistedSellingStoreSettingsResult = AssistedSellingEffectiveSettings & {
  settingsId: string
  storeId: string
  updatedAt: string | null
}

function parseCommandInput(rawInput: unknown): AssistedSellingStoreSettingsSaveInput {
  const parsed = assistedSellingStoreSettingsSaveSchema.safeParse(rawInput ?? {})
  if (!parsed.success) {
    throw new CrudHttpError(400, { error: 'assisted_selling.errors.invalidInput' })
  }
  return parsed.data
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function applySettingsUpdate(
  settings: AssistedSellingStoreSettings,
  input: AssistedSellingStoreSettingsSaveInput,
): void {
  if (input.mode !== undefined) settings.mode = input.mode
  if (input.proposalTtlSeconds !== undefined) settings.proposalTtlSeconds = input.proposalTtlSeconds
  if (input.maxProposalLines !== undefined) settings.maxProposalLines = input.maxProposalLines
  if (input.conversationRetentionDays !== undefined) {
    settings.conversationRetentionDays = input.conversationRetentionDays
  }
  if (input.idleCloseDays !== undefined) settings.idleCloseDays = input.idleCloseDays
}

function buildResult(settings: AssistedSellingStoreSettings): SaveAssistedSellingStoreSettingsResult {
  return {
    ...toEffectiveAssistedSellingSettings(settings),
    settingsId: settings.id,
    storeId: settings.storeId,
    updatedAt: toIso(settings.updatedAt),
  }
}

const saveAssistedSellingStoreSettingsCommand: CommandHandler<
  AssistedSellingStoreSettingsSaveInput,
  SaveAssistedSellingStoreSettingsResult
> = {
  id: 'assisted_selling.settings.save',
  async execute(rawInput, ctx) {
    const input = parseCommandInput(rawInput)
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)

    const scope = { tenantId: input.tenantId, organizationId: input.organizationId, storeId: input.storeId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const existing = await loadAssistedSellingStoreSettings(em, scope)

    if (existing) {
      await enforceAssistedSellingOptimisticLock(ctx, existing, ASSISTED_SELLING_STORE_SETTINGS_RESOURCE_KIND)
    }

    const now = new Date()
    const settings =
      existing ??
      em.create(AssistedSellingStoreSettings, {
        ...scope,
        ...ASSISTED_SELLING_STORE_SETTINGS_DEFAULTS,
        createdAt: now,
        updatedAt: now,
      })

    try {
      await withAtomicFlush(
        em,
        [
          () => {
            if (!existing) em.persist(settings)
            applySettingsUpdate(settings, input)
            if (existing) settings.updatedAt = now
          },
        ],
        { transaction: true, label: 'assisted_selling.settings.save' },
      )
    } catch (error) {
      if (existing || !isUniqueViolation(error)) throw error
      const winner = await loadAssistedSellingStoreSettings(
        (ctx.container.resolve('em') as EntityManager).fork(),
        scope,
      )
      if (!winner) throw error
      const currentUpdatedAt = toIso(winner.updatedAt)
      const expectedUpdatedAt = toIso(settings.updatedAt)
      if (currentUpdatedAt && expectedUpdatedAt) {
        throw new CrudHttpError(409, buildOptimisticLockConflictBody(currentUpdatedAt, expectedUpdatedAt))
      }
      throw new CrudHttpError(409, { error: 'assisted_selling.errors.conflict' })
    }

    return buildResult(settings)
  },
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('assisted_selling.audit.settings.save', 'Save assisted selling settings'),
      resourceKind: ASSISTED_SELLING_STORE_SETTINGS_RESOURCE_KIND,
      resourceId: result.settingsId,
    }
  },
}

registerCommand(saveAssistedSellingStoreSettingsCommand)

export const assistedSellingSettingsCommands = [saveAssistedSellingStoreSettingsCommand]

export { saveAssistedSellingStoreSettingsCommand }
