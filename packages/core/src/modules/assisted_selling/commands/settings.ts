import { UniqueConstraintViolationException } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { buildOptimisticLockConflictBody } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { AssistedSellingStoreSettings } from '../data/entities'
import {
  assistedSellingStoreSettingsSaveSchema,
  type AssistedSellingStoreSettingsSaveInput,
} from '../data/validators'
import {
  ASSISTED_SELLING_STORE_SETTINGS_DEFAULTS,
  loadAssistedSellingStoreSettings,
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

function isUniqueViolation(error: unknown): boolean {
  if (error instanceof UniqueConstraintViolationException) return true
  if (!error || typeof error !== 'object') return false
  if ((error as { code?: string }).code === '23505') return true
  const message = (error as { message?: string }).message
  return typeof message === 'string' && message.includes('duplicate key')
}

function hasOwn(input: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key)
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
  if (hasOwn(input, 'mode') && input.mode !== undefined) settings.mode = input.mode
  if (hasOwn(input, 'proposalTtlSeconds') && input.proposalTtlSeconds !== undefined) {
    settings.proposalTtlSeconds = input.proposalTtlSeconds
  }
  if (hasOwn(input, 'maxProposalLines') && input.maxProposalLines !== undefined) {
    settings.maxProposalLines = input.maxProposalLines
  }
  if (hasOwn(input, 'conversationRetentionDays') && input.conversationRetentionDays !== undefined) {
    settings.conversationRetentionDays = input.conversationRetentionDays
  }
  if (hasOwn(input, 'idleCloseDays') && input.idleCloseDays !== undefined) {
    settings.idleCloseDays = input.idleCloseDays
  }
}

function buildResult(settings: AssistedSellingStoreSettings): SaveAssistedSellingStoreSettingsResult {
  return {
    settingsId: settings.id,
    storeId: settings.storeId,
    mode: settings.mode,
    proposalTtlSeconds: settings.proposalTtlSeconds,
    maxProposalLines: settings.maxProposalLines,
    conversationRetentionDays: settings.conversationRetentionDays,
    idleCloseDays: settings.idleCloseDays,
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

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let settings = await loadAssistedSellingStoreSettings(em, {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      storeId: input.storeId,
    })
    const exists = Boolean(settings)

    if (settings) {
      await enforceAssistedSellingOptimisticLock(ctx, settings, ASSISTED_SELLING_STORE_SETTINGS_RESOURCE_KIND)
    } else {
      const now = new Date()
      settings = em.create(AssistedSellingStoreSettings, {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        storeId: input.storeId,
        mode: ASSISTED_SELLING_STORE_SETTINGS_DEFAULTS.mode,
        proposalTtlSeconds: ASSISTED_SELLING_STORE_SETTINGS_DEFAULTS.proposalTtlSeconds,
        maxProposalLines: ASSISTED_SELLING_STORE_SETTINGS_DEFAULTS.maxProposalLines,
        conversationRetentionDays: ASSISTED_SELLING_STORE_SETTINGS_DEFAULTS.conversationRetentionDays,
        idleCloseDays: ASSISTED_SELLING_STORE_SETTINGS_DEFAULTS.idleCloseDays,
        createdAt: now,
        updatedAt: now,
      })
      em.persist(settings)
    }

    applySettingsUpdate(settings, input)
    if (exists) settings.updatedAt = new Date()

    try {
      await em.flush()
    } catch (error) {
      if (exists || !isUniqueViolation(error)) throw error
      const retryEm = (ctx.container.resolve('em') as EntityManager).fork()
      const winner = await loadAssistedSellingStoreSettings(retryEm, {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        storeId: input.storeId,
      })
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
}

registerCommand(saveAssistedSellingStoreSettingsCommand)

export const assistedSellingSettingsCommands = [saveAssistedSellingStoreSettingsCommand]

export { saveAssistedSellingStoreSettingsCommand }
