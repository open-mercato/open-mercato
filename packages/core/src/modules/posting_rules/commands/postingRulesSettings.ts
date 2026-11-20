import { randomUUID } from 'crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { conflict } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { LedgerAccount } from '../../ledger/data/entities'
import { PostingRulesSettings } from '../data/entities'
import { updatePostingRulesSettingsSchema, type UpdatePostingRulesSettingsInput } from '../data/validators'

export const POSTING_RULES_SETTINGS_RESOURCE_KIND = 'posting_rules.settings'

type Scope = { organizationId: string; tenantId: string }

export type UpdatePostingRulesSettingsResult = {
  settingsId: string
  clearingAccountId: string | null
  unallocatedCostAccountId: string | null
  updatedAt: string | null
}

async function requireExistingLedgerAccount(
  em: EntityManager,
  accountId: string,
  scope: Scope,
  translate: (key: string, fallback: string) => string,
  errorKey: string,
  errorFallback: string,
): Promise<void> {
  const account = await em.findOne(LedgerAccount, {
    id: accountId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  })
  if (!account) throw conflict(translate(errorKey, errorFallback))
}

function toIso(value: Date | null | undefined): string | null {
  if (!value) return null
  return value.toISOString()
}

function buildResult(settings: PostingRulesSettings): UpdatePostingRulesSettingsResult {
  return {
    settingsId: settings.id,
    clearingAccountId: settings.clearingAccountId ?? null,
    unallocatedCostAccountId: settings.unallocatedCostAccountId ?? null,
    updatedAt: toIso(settings.updatedAt),
  }
}

/**
 * `updatePostingRulesSettings` — upserts `PostingRulesSettings`
 * (`clearingAccountId`/`unallocatedCostAccountId`), the same
 * upsert-only-no-create shape as `updateFixedAssetSettings`/
 * `warranty_claims.settings.save` (see Design Decisions, "New settings:
 * `PostingRulesSettings`"). The row is normally always present already
 * (seeded empty by `lib/seedDefaults.ts` at module-enable time), but this
 * still creates it on the fly if somehow missing, matching the same
 * defensive shape `warranty_claims`' own settings command uses.
 */
const updatePostingRulesSettingsCommand: CommandHandler<UpdatePostingRulesSettingsInput, UpdatePostingRulesSettingsResult> = {
  id: 'posting_rules.updatePostingRulesSettings',
  async execute(rawInput, ctx) {
    const input = updatePostingRulesSettingsSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope: Scope = { organizationId: input.organizationId, tenantId: input.tenantId }
    const { translate } = await resolveTranslations()

    if (input.clearingAccountId) {
      await requireExistingLedgerAccount(
        em, input.clearingAccountId, scope, translate,
        'posting_rules.errors.clearingAccountNotFoundForOrg', 'The specified clearing account does not exist for this organization.',
      )
    }
    if (input.unallocatedCostAccountId) {
      await requireExistingLedgerAccount(
        em, input.unallocatedCostAccountId, scope, translate,
        'posting_rules.errors.unallocatedCostAccountNotFoundForOrg', 'The specified unallocated-cost account does not exist for this organization.',
      )
    }

    let settings = await em.findOne(PostingRulesSettings, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    })

    enforceCommandOptimisticLock({
      resourceKind: POSTING_RULES_SETTINGS_RESOURCE_KIND,
      resourceId: `${scope.organizationId}:${scope.tenantId}`,
      current: settings?.updatedAt ?? null,
      request: ctx.request ?? null,
    })

    if (!settings) {
      settings = em.create(PostingRulesSettings, {
        id: randomUUID(),
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        clearingAccountId: null,
        unallocatedCostAccountId: null,
        updatedAt: new Date(),
      })
      em.persist(settings)
    }

    if (Object.prototype.hasOwnProperty.call(input, 'clearingAccountId')) {
      settings.clearingAccountId = input.clearingAccountId ?? null
    }
    if (Object.prototype.hasOwnProperty.call(input, 'unallocatedCostAccountId')) {
      settings.unallocatedCostAccountId = input.unallocatedCostAccountId ?? null
    }
    settings.updatedAt = new Date()

    await em.flush()

    return buildResult(settings)
  },
  buildLog: async ({ input, result, ctx }) => {
    if (!result) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('posting_rules.audit.updatePostingRulesSettings', 'Update posting rules settings'),
      resourceKind: POSTING_RULES_SETTINGS_RESOURCE_KIND,
      resourceId: result.settingsId,
      tenantId: input?.tenantId ?? ctx.auth?.tenantId ?? null,
      organizationId: input?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
    }
  },
}

registerCommand(updatePostingRulesSettingsCommand)

export { updatePostingRulesSettingsCommand }
