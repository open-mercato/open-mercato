import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerSettings, type CustomerAddressFormat } from '../data/entities'
import {
  customerDictionarySortModesUpsertSchema,
  customerSettingsUpsertSchema,
  customerStuckThresholdUpsertSchema,
  type CustomerDictionarySortModesUpsertInput,
  type CustomerSettingsUpsertInput,
  type CustomerStuckThresholdUpsertInput,
} from '../data/validators'
import { ensureOrganizationScope, ensureTenantScope } from './shared'

/**
 * Tenant-scoped settings lookup. `CustomerSettings` carries no encrypted columns today
 * (just enum + int scalars + scope/timestamps), so `findOneWithDecryption` is effectively
 * a passthrough. We use it anyway per the production-code rule in `packages/core/AGENTS.md`
 * § Encryption — the wrapper is mandatory regardless of current encrypted-field count so
 * future GDPR additions don't need a route-level migration. Scope hints are required so the
 * decryption helper can resolve the tenant DEK if any encrypted field is added later.
 */
export async function loadCustomerSettings(
  em: EntityManager,
  params: { tenantId: string; organizationId: string }
): Promise<CustomerSettings | null> {
  return findOneWithDecryption(
    em,
    CustomerSettings,
    {
      tenantId: params.tenantId,
      organizationId: params.organizationId,
    },
    undefined,
    { tenantId: params.tenantId, organizationId: params.organizationId },
  )
}

const saveCustomerSettingsCommand: CommandHandler<
  CustomerSettingsUpsertInput,
  { settingsId: string; addressFormat: CustomerAddressFormat }
> = {
  id: 'customers.settings.save',
  async execute(rawInput, ctx) {
    const input = customerSettingsUpsertSchema.parse(rawInput)
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let settings = await loadCustomerSettings(em, {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    })

    if (!settings) {
      settings = em.create(CustomerSettings, {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        addressFormat: input.addressFormat,
      })
      em.persist(settings)
    } else if (settings.addressFormat !== input.addressFormat) {
      settings.addressFormat = input.addressFormat
      settings.updatedAt = new Date()
    }

    await em.flush()

    return {
      settingsId: settings.id,
      addressFormat: settings.addressFormat,
    }
  },
}

registerCommand(saveCustomerSettingsCommand)

const saveStuckThresholdCommand: CommandHandler<
  CustomerStuckThresholdUpsertInput,
  { settingsId: string; stuckThresholdDays: number }
> = {
  id: 'customers.settings.save_stuck_threshold',
  async execute(rawInput, ctx) {
    const input = customerStuckThresholdUpsertSchema.parse(rawInput)
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let settings = await loadCustomerSettings(em, {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    })

    if (!settings) {
      settings = em.create(CustomerSettings, {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        stuckThresholdDays: input.stuckThresholdDays,
      })
      em.persist(settings)
    } else if (settings.stuckThresholdDays !== input.stuckThresholdDays) {
      settings.stuckThresholdDays = input.stuckThresholdDays
      settings.updatedAt = new Date()
    }

    await em.flush()

    return {
      settingsId: settings.id,
      stuckThresholdDays: settings.stuckThresholdDays,
    }
  },
}

registerCommand(saveStuckThresholdCommand)

const saveDictionarySortModesCommand: CommandHandler<
  CustomerDictionarySortModesUpsertInput,
  { settingsId: string; dictionarySortModes: CustomerDictionarySortModesUpsertInput['dictionarySortModes'] }
> = {
  id: 'customers.settings.save_dictionary_sort_modes',
  async execute(rawInput, ctx) {
    const input = customerDictionarySortModesUpsertSchema.parse(rawInput)
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let settings = await loadCustomerSettings(em, {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    })

    if (!settings) {
      settings = em.create(CustomerSettings, {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        dictionarySortModes: input.dictionarySortModes,
      })
      em.persist(settings)
    } else {
      settings.dictionarySortModes = input.dictionarySortModes
      settings.updatedAt = new Date()
    }

    await em.flush()

    return {
      settingsId: settings.id,
      dictionarySortModes: settings.dictionarySortModes ?? {},
    }
  },
}

registerCommand(saveDictionarySortModesCommand)
