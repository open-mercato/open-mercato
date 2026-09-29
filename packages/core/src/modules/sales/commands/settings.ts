import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { SalesSettings } from '../data/entities'
import { salesSettingsUpsertSchema, type SalesSettingsUpsertInput } from '../data/validators'
import { ensureOrganizationScope, ensureTenantScope } from './shared'
import { SalesDocumentNumberGenerator } from '../services/salesDocumentNumberGenerator'

async function ensureNumberEditPermission(ctx: CommandRuntimeContext, organizationId: string) {
  const rbac = ctx.container.resolve('rbacService') as RbacService | null
  const auth = ctx.auth
  if (!rbac || !auth?.sub) return
  const ok = await rbac.userHasAllFeatures(auth.sub, ['sales.documents.number.edit'], {
    tenantId: auth.tenantId ?? null,
    organizationId,
  })
  if (!ok) {
    const { translate } = await resolveTranslations()
    throw new CrudHttpError(403, {
      error: translate('sales.documents.errors.number_edit_forbidden', 'Document number cannot be edited.'),
    })
  }
}

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

    const generator = ctx.container.resolve('salesDocumentNumberGenerator') as SalesDocumentNumberGenerator
    const current = await generator.peekSequences(input)
    const orderNextNumber =
      input.orderNextNumber && input.orderNextNumber !== current.order ? input.orderNextNumber : undefined
    const quoteNextNumber =
      input.quoteNextNumber && input.quoteNextNumber !== current.quote ? input.quoteNextNumber : undefined
    if (orderNextNumber || quoteNextNumber) {
      await ensureNumberEditPermission(ctx, input.organizationId)
    }

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

    if (orderNextNumber) {
      await generator.setNextSequence('order', input, orderNextNumber)
    }
    if (quoteNextNumber) {
      await generator.setNextSequence('quote', input, quoteNextNumber)
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

registerCommand(saveSalesSettingsCommand)
