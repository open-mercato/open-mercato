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
    const rootEm = ctx.container.resolve<EntityManager>('em')
    // Isolate the locked read from the route's earlier settings lookup.
    const em = rootEm.fork()
    let settings!: AssistedSellingStoreSettings
    let attemptedCreationAt: Date | undefined

    try {
      await withAtomicFlush(
        em,
        [
          async () => {
            const existing = await loadAssistedSellingStoreSettings(em, scope, true)
            if (existing) {
              await enforceAssistedSellingOptimisticLock(ctx, existing)
              settings = existing
              settings.updatedAt = new Date(Math.max(Date.now(), existing.updatedAt.getTime() + 1))
            } else {
              attemptedCreationAt = new Date()
              settings = em.create(AssistedSellingStoreSettings, {
                ...scope,
                ...ASSISTED_SELLING_STORE_SETTINGS_DEFAULTS,
                createdAt: attemptedCreationAt,
                updatedAt: attemptedCreationAt,
              })
              em.persist(settings)
            }
            applySettingsUpdate(settings, input)
          },
        ],
        { transaction: true, label: 'assisted_selling.settings.save' },
      )
    } catch (error) {
      if (!attemptedCreationAt || !isUniqueViolation(error)) throw error
      // Read the committed winner with a clean identity map after rollback.
      const winner = await loadAssistedSellingStoreSettings(rootEm.fork(), scope)
      if (!winner) throw error
      const currentUpdatedAt = toIso(winner.updatedAt)
      if (currentUpdatedAt) {
        throw new CrudHttpError(409, buildOptimisticLockConflictBody(currentUpdatedAt, attemptedCreationAt.toISOString()))
      }
      throw new CrudHttpError(409, { error: 'assisted_selling.errors.conflict' })
    }

    return buildResult(settings)
  },
  buildLog: async ({ input, result }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('assisted_selling.audit.settings.save', 'Save assisted selling settings'),
      resourceKind: ASSISTED_SELLING_STORE_SETTINGS_RESOURCE_KIND,
      resourceId: result.settingsId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    }
  },
}

registerCommand(saveAssistedSellingStoreSettingsCommand)

export const assistedSellingSettingsCommands = [saveAssistedSellingStoreSettingsCommand]

export { saveAssistedSellingStoreSettingsCommand }
