import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { SalesSettings } from '../data/entities'
import { salesSettingsUpsertSchema, type SalesSettingsUpsertInput } from '../data/validators'
import { ensureOrganizationScope, ensureTenantScope } from './shared'
import { SalesDocumentNumberGenerator } from '../services/salesDocumentNumberGenerator'

export async function loadSalesSettings(
  em: EntityManager,
  params: { tenantId: string; organizationId: string }
): Promise<SalesSettings | null> {
  return em.findOne(SalesSettings, {
    tenantId: params.tenantId,
    organizationId: params.organizationId,
  })
}

/**
 * Whether the shipped-line freeze applies to this scope.
 *
 * The freeze refuses changes to the commercial terms of an order line that already
 * has shipment items — unit price, discount, tax rate, unit, derived totals, and a
 * quantity below what shipped. It is the platform's historical behaviour and stays
 * on unless a scope opts out through `orderShippedLineEditable`, so a scope with no
 * `sales_settings` row resolves to enforced, exactly like a scope that has one and
 * never touched the setting.
 *
 * This is the single place the freeze asks whether it applies; the command layer and
 * the settings API both read the answer from here.
 */
export async function isShippedLineFreezeEnforced(
  em: EntityManager,
  params: { tenantId: string; organizationId: string }
): Promise<boolean> {
  const settings = await loadSalesSettings(em, params)
  return settings?.orderShippedLineEditable !== true
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
    orderShippedLineEditable: boolean
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
        orderShippedLineEditable: input.orderShippedLineEditable ?? false,
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
      if (input.orderShippedLineEditable !== undefined) {
        settings.orderShippedLineEditable = input.orderShippedLineEditable
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
      orderShippedLineEditable: settings.orderShippedLineEditable === true,
    }
  },
}

registerCommand(saveSalesSettingsCommand)
