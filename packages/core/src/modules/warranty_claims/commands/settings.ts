import { UniqueConstraintViolationException } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { WarrantyClaimSettings } from '../data/entities'
import {
  warrantyClaimSettingsSaveSchema,
  type WarrantyClaimSettingsSaveInput,
  type WarrantyClaimSettingsUpdateInput,
} from '../data/validators'
import {
  WARRANTY_CLAIM_SETTINGS_DEFAULTS,
  loadWarrantyClaimSettings,
  type WarrantyClaimEffectiveSettings,
} from '../lib/settings'
import {
  enforceWarrantyClaimOptimisticLock,
  ensureOrganizationScope,
  ensureTenantScope,
} from './shared'

export const WARRANTY_CLAIM_SETTINGS_RESOURCE_KIND = 'warranty_claims.settings'

export type SaveWarrantyClaimSettingsResult = WarrantyClaimEffectiveSettings & {
  settingsId: string
  returnWindowDays: number | null
  updatedAt: string | null
}

function parseCommandInput(rawInput: unknown): WarrantyClaimSettingsSaveInput {
  const parsed = warrantyClaimSettingsSaveSchema.safeParse(rawInput ?? {})
  if (!parsed.success) {
    throw new CrudHttpError(400, { error: 'warranty_claims.errors.invalidInput' })
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

function amountString(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null
  return String(value)
}

function amountNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function applySettingsUpdate(settings: WarrantyClaimSettings, input: WarrantyClaimSettingsUpdateInput): void {
  if (hasOwn(input, 'slaHours') && input.slaHours !== undefined) settings.slaHours = input.slaHours
  if (hasOwn(input, 'slaPauseOnInfoRequested') && input.slaPauseOnInfoRequested !== undefined) {
    settings.slaPauseOnInfoRequested = input.slaPauseOnInfoRequested
  }
  if (hasOwn(input, 'slaAtRiskThresholdPct') && input.slaAtRiskThresholdPct !== undefined) {
    settings.slaAtRiskThresholdPct = input.slaAtRiskThresholdPct
  }
  if (hasOwn(input, 'autoApproveEnabled') && input.autoApproveEnabled !== undefined) {
    settings.autoApproveEnabled = input.autoApproveEnabled
  }
  if (hasOwn(input, 'autoApproveMaxAmount')) settings.autoApproveMaxAmount = amountString(input.autoApproveMaxAmount)
  if (hasOwn(input, 'autoApproveCurrencyCode')) settings.autoApproveCurrencyCode = input.autoApproveCurrencyCode ?? null
  if (hasOwn(input, 'autoApproveRequireInWarranty') && input.autoApproveRequireInWarranty !== undefined) {
    settings.autoApproveRequireInWarranty = input.autoApproveRequireInWarranty
  }
  if (hasOwn(input, 'defaultWarrantyMonths')) settings.defaultWarrantyMonths = input.defaultWarrantyMonths ?? null
  if (hasOwn(input, 'businessHours')) settings.businessHours = input.businessHours ?? null
  if (hasOwn(input, 'escalationTiers')) settings.escalationTiers = input.escalationTiers ?? null
  if (hasOwn(input, 'adjudicationUseRules') && input.adjudicationUseRules !== undefined) {
    settings.adjudicationUseRules = input.adjudicationUseRules
  }
  if (hasOwn(input, 'quarantineGrades')) settings.quarantineGrades = input.quarantineGrades ?? null
  if (hasOwn(input, 'returnLabelProvider')) settings.returnLabelProvider = input.returnLabelProvider ?? null
  if (hasOwn(input, 'returnWindowDays')) settings.returnWindowDays = input.returnWindowDays ?? null
}

function assertAutoApproveConfig(settings: WarrantyClaimSettings): void {
  if (!settings.autoApproveEnabled) return
  if (settings.autoApproveMaxAmount !== null && settings.autoApproveMaxAmount !== undefined && settings.autoApproveCurrencyCode) return
  throw new CrudHttpError(400, { error: 'warranty_claims.errors.autoApproveConfigIncomplete' })
}

function buildResult(settings: WarrantyClaimSettings): SaveWarrantyClaimSettingsResult {
  return {
    settingsId: settings.id,
    slaHours: settings.slaHours,
    slaPauseOnInfoRequested: settings.slaPauseOnInfoRequested,
    slaAtRiskThresholdPct: settings.slaAtRiskThresholdPct,
    autoApproveEnabled: settings.autoApproveEnabled,
    autoApproveMaxAmount: amountNumber(settings.autoApproveMaxAmount),
    autoApproveCurrencyCode: settings.autoApproveCurrencyCode ?? null,
    autoApproveRequireInWarranty: settings.autoApproveRequireInWarranty,
    defaultWarrantyMonths: settings.defaultWarrantyMonths ?? null,
    businessHours: settings.businessHours ?? null,
    escalationTiers: settings.escalationTiers ?? null,
    adjudicationUseRules: settings.adjudicationUseRules,
    quarantineGrades: settings.quarantineGrades ?? null,
    returnLabelProvider: settings.returnLabelProvider ?? null,
    returnWindowDays: settings.returnWindowDays ?? null,
    updatedAt: toIso(settings.updatedAt),
  }
}

const saveWarrantyClaimSettingsCommand: CommandHandler<
  WarrantyClaimSettingsSaveInput,
  SaveWarrantyClaimSettingsResult
> = {
  id: 'warranty_claims.settings.save',
  async execute(rawInput, ctx) {
    const input = parseCommandInput(rawInput)
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let settings = await loadWarrantyClaimSettings(em, {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    })
    const exists = Boolean(settings)

    if (settings) {
      await enforceWarrantyClaimOptimisticLock(ctx, settings, WARRANTY_CLAIM_SETTINGS_RESOURCE_KIND)
    } else {
      const now = new Date()
      settings = em.create(WarrantyClaimSettings, {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        slaHours: WARRANTY_CLAIM_SETTINGS_DEFAULTS.slaHours,
        slaPauseOnInfoRequested: WARRANTY_CLAIM_SETTINGS_DEFAULTS.slaPauseOnInfoRequested,
        slaAtRiskThresholdPct: WARRANTY_CLAIM_SETTINGS_DEFAULTS.slaAtRiskThresholdPct,
        autoApproveEnabled: WARRANTY_CLAIM_SETTINGS_DEFAULTS.autoApproveEnabled,
        autoApproveMaxAmount: null,
        autoApproveCurrencyCode: null,
        autoApproveRequireInWarranty: WARRANTY_CLAIM_SETTINGS_DEFAULTS.autoApproveRequireInWarranty,
        defaultWarrantyMonths: WARRANTY_CLAIM_SETTINGS_DEFAULTS.defaultWarrantyMonths,
        businessHours: WARRANTY_CLAIM_SETTINGS_DEFAULTS.businessHours,
        escalationTiers: WARRANTY_CLAIM_SETTINGS_DEFAULTS.escalationTiers,
        adjudicationUseRules: WARRANTY_CLAIM_SETTINGS_DEFAULTS.adjudicationUseRules,
        quarantineGrades: WARRANTY_CLAIM_SETTINGS_DEFAULTS.quarantineGrades,
        returnLabelProvider: WARRANTY_CLAIM_SETTINGS_DEFAULTS.returnLabelProvider,
        returnWindowDays: null,
        createdAt: now,
        updatedAt: now,
      })
      em.persist(settings)
    }

    applySettingsUpdate(settings, input)
    assertAutoApproveConfig(settings)
    if (exists) settings.updatedAt = new Date()

    try {
      await em.flush()
    } catch (error) {
      // Two admins saving settings for the first time race on
      // `warranty_claim_settings_scope_unique`. The loser lost a insert, not data —
      // reload the row the winner created and re-apply this save on top of it rather
      // than surfacing a unique-violation 500.
      if (exists || !isUniqueViolation(error)) throw error
      const retryEm = (ctx.container.resolve('em') as EntityManager).fork()
      const winner = await loadWarrantyClaimSettings(retryEm, {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      })
      if (!winner) throw error
      applySettingsUpdate(winner, input)
      assertAutoApproveConfig(winner)
      winner.updatedAt = new Date()
      await retryEm.flush()
      return buildResult(winner)
    }

    return buildResult(settings)
  },
}

registerCommand(saveWarrantyClaimSettingsCommand)

export const warrantyClaimSettingsCommands = [saveWarrantyClaimSettingsCommand]

export {
  saveWarrantyClaimSettingsCommand,
}
