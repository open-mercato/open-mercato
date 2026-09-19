import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { SalesSettings } from '../data/entities'
import {
  salesSettingsUpsertSchema,
  salesTaxProviderSettingsSchema,
  type SalesSettingsUpsertInput,
  type SalesTaxProviderSettingsInput,
} from '../data/validators'
import { getTaxProvider, normalizeProviderSettings } from '../lib/providers'
import { DEFAULT_TAX_PROVIDER_KEY } from '../lib/providers/taxContext'
import { invalidateTaxProviderSelection } from '../lib/taxProviderSelection'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { ensureOrganizationScope, ensureTenantScope, extractUndoPayload } from './shared'
import { SalesDocumentNumberGenerator } from '../services/salesDocumentNumberGenerator'
import {
  DEFAULT_ORDER_NUMBER_FORMAT,
  DEFAULT_QUOTE_NUMBER_FORMAT,
} from '../lib/documentNumberTokens'

export async function loadSalesSettings(
  em: EntityManager,
  params: { tenantId: string; organizationId: string }
): Promise<SalesSettings | null> {
  return em.findOne(SalesSettings, {
    tenantId: params.tenantId,
    organizationId: params.organizationId,
  })
}

const saveSalesSettingsCommand: CommandHandler<
  SalesSettingsUpsertInput,
  {
    settingsId: string
    orderNumberFormat: string
    quoteNumberFormat: string
    nextOrderNumber: number
    nextQuoteNumber: number
    orderCustomerEditableStatuses: string[] | null
    orderAddressEditableStatuses: string[] | null
  }
> = {
  id: 'sales.settings.save',
  async execute(rawInput, ctx) {
    const input = salesSettingsUpsertSchema.parse(rawInput)
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let settings = await loadSalesSettings(em, {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    })

    const orderFormat = input.orderNumberFormat.trim()
    const quoteFormat = input.quoteNumberFormat.trim()

    if (!settings) {
      settings = em.create(SalesSettings, {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        orderNumberFormat: orderFormat,
        quoteNumberFormat: quoteFormat,
        orderCustomerEditableStatuses: input.orderCustomerEditableStatuses ?? null,
        orderAddressEditableStatuses: input.orderAddressEditableStatuses ?? null,
      })
      em.persist(settings)
    } else {
      settings.orderNumberFormat = orderFormat
      settings.quoteNumberFormat = quoteFormat
      if (input.orderCustomerEditableStatuses !== undefined) {
        settings.orderCustomerEditableStatuses = input.orderCustomerEditableStatuses ?? null
      }
      if (input.orderAddressEditableStatuses !== undefined) {
        settings.orderAddressEditableStatuses = input.orderAddressEditableStatuses ?? null
      }
      settings.updatedAt = new Date()
    }

    await em.flush()

    const generator = ctx.container.resolve('salesDocumentNumberGenerator') as SalesDocumentNumberGenerator
    if (input.orderNextNumber) {
      await generator.setNextSequence('order', input, input.orderNextNumber)
    }
    if (input.quoteNextNumber) {
      await generator.setNextSequence('quote', input, input.quoteNextNumber)
    }
    const sequences = await generator.peekSequences(input)

    return {
      settingsId: settings.id,
      orderNumberFormat: settings.orderNumberFormat,
      quoteNumberFormat: settings.quoteNumberFormat,
      nextOrderNumber: sequences.order,
      nextQuoteNumber: sequences.quote,
      orderCustomerEditableStatuses: settings.orderCustomerEditableStatuses ?? null,
      orderAddressEditableStatuses: settings.orderAddressEditableStatuses ?? null,
    }
  },
}

type TaxProviderSettingsSnapshot = {
  tenantId: string
  organizationId: string
  providerKey: string | null
  providerSettings: Record<string, unknown> | null
  timeoutMs: number | null
  shipFromAddress: Record<string, unknown> | null
}

type TaxProviderSettingsUndo = { before?: TaxProviderSettingsSnapshot | null }

function snapshotTaxProviderSettings(
  settings: SalesSettings | null,
  scope: { tenantId: string; organizationId: string },
): TaxProviderSettingsSnapshot {
  return {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    providerKey: settings?.taxProviderKey ?? null,
    providerSettings: settings?.taxProviderSettings ?? null,
    timeoutMs: settings?.taxProviderTimeoutMs ?? null,
    shipFromAddress: settings?.shipFromAddress ?? null,
  }
}

/**
 * Saves the organization's tax provider selection.
 *
 * The provider must be registered: an unknown key would silently degrade every
 * later calculation to a `fallback` with `provider_missing`, which is a worse
 * outcome than refusing the save. Settings are normalized through the provider's
 * own schema, and any key the provider declared as a secret is refused outright
 * — secrets belong to the integrations module, which encrypts them at rest.
 */
const saveTaxProviderSettingsCommand: CommandHandler<
  SalesTaxProviderSettingsInput,
  {
    settingsId: string
    providerKey: string
    providerSettings: Record<string, unknown> | null
    timeoutMs: number | null
    shipFromAddress: Record<string, unknown> | null
  }
> = {
  id: 'sales.settings.save_tax_provider',
  async prepare(rawInput, ctx) {
    const input = salesTaxProviderSettingsSchema.safeParse(rawInput)
    if (!input.success) return {}
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const settings = await loadSalesSettings(em, {
      tenantId: input.data.tenantId,
      organizationId: input.data.organizationId,
    })
    return { before: snapshotTaxProviderSettings(settings, input.data) }
  },
  async execute(rawInput, ctx) {
    const input = salesTaxProviderSettingsSchema.parse(rawInput)
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)

    const provider = getTaxProvider(input.providerKey)
    if (!provider) {
      throw new CrudHttpError(400, {
        error: `Unknown tax provider "${input.providerKey}".`,
        code: 'sales.tax_provider_unknown',
      })
    }

    const declaredSecretKeys = new Set(
      (provider.settings?.fields ?? [])
        .filter((field) => field.type === 'secret')
        .map((field) => field.key),
    )
    const suppliedSettings = input.providerSettings ?? null
    if (suppliedSettings) {
      for (const key of Object.keys(suppliedSettings)) {
        if (declaredSecretKeys.has(key)) {
          throw new CrudHttpError(400, {
            error: `"${key}" is a secret and belongs to the integration, not to provider settings.`,
            code: 'sales.tax_provider_secret_field',
          })
        }
      }
    }

    const normalizedSettings =
      normalizeProviderSettings('tax', provider.key, suppliedSettings ?? {}) ?? suppliedSettings

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let settings = await loadSalesSettings(em, {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    })

    if (!settings) {
      // An organization that never opened the sales configuration page has no
      // settings row yet; selecting a tax provider creates it with the same
      // numbering defaults the entity carries.
      settings = em.create(SalesSettings, {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        orderNumberFormat: DEFAULT_ORDER_NUMBER_FORMAT,
        quoteNumberFormat: DEFAULT_QUOTE_NUMBER_FORMAT,
      })
      em.persist(settings)
    }

    // A selection of the built in default is stored as NULL, which is the same
    // state an organization that never opened this page is in.
    settings.taxProviderKey =
      provider.key === DEFAULT_TAX_PROVIDER_KEY ? null : provider.key
    settings.taxProviderSettings = normalizedSettings ?? null
    if (input.timeoutMs !== undefined) settings.taxProviderTimeoutMs = input.timeoutMs ?? null
    if (input.shipFromAddress !== undefined) {
      settings.shipFromAddress = (input.shipFromAddress ?? null) as Record<string, unknown> | null
    }
    settings.updatedAt = new Date()

    await em.flush()

    // After the write commits, never inside it.
    await invalidateTaxProviderSelection({
      container: ctx.container,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    })

    return {
      settingsId: settings.id,
      providerKey: settings.taxProviderKey ?? DEFAULT_TAX_PROVIDER_KEY,
      providerSettings: settings.taxProviderSettings ?? null,
      timeoutMs: settings.taxProviderTimeoutMs ?? null,
      shipFromAddress: settings.shipFromAddress ?? null,
    }
  },
  buildLog: async ({ snapshots, input }) => {
    const before = (snapshots.before as TaxProviderSettingsSnapshot | undefined) ?? null
    return {
      actionLabel: 'Save tax provider settings',
      resourceKind: 'sales.settings',
      resourceId: input.organizationId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      snapshotBefore: before,
      snapshotAfter: null,
      payload: { undo: { before } satisfies TaxProviderSettingsUndo },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TaxProviderSettingsUndo>(logEntry)
    const before = payload?.before
    if (!before) return
    ensureTenantScope(ctx, before.tenantId)
    ensureOrganizationScope(ctx, before.organizationId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const settings = await loadSalesSettings(em, {
      tenantId: before.tenantId,
      organizationId: before.organizationId,
    })
    if (!settings) return
    settings.taxProviderKey = before.providerKey
    settings.taxProviderSettings = before.providerSettings
    settings.taxProviderTimeoutMs = before.timeoutMs
    settings.shipFromAddress = before.shipFromAddress
    settings.updatedAt = new Date()
    await em.flush()
    await invalidateTaxProviderSelection({
      container: ctx.container,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
    })
  },
}

registerCommand(saveSalesSettingsCommand)
registerCommand(saveTaxProviderSettingsCommand)
