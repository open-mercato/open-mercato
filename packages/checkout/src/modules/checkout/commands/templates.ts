import type { EntityManager } from '@mikro-orm/postgresql'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { setCustomFieldsIfAny } from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CheckoutLinkTemplate } from '../data/entities'
import { createTemplateSchema, updateTemplateSchema } from '../data/validators'
import { CHECKOUT_ENTITY_IDS } from '../lib/constants'
import {
  deriveConfiguredCurrencies,
  hashCheckoutPassword,
  parseCheckoutInput,
  serializeTemplateOrLink,
  toMoneyString,
  validateDescriptorCurrencies,
} from '../lib/utils'
import { readCommandId, resolveCommandScope } from './shared'

const createTemplateCommand: CommandHandler<Record<string, unknown>, { id: string }> = {
  id: 'checkout.template.create',
  async execute(rawInput, ctx) {
    const { parsed, customFields } = parseCheckoutInput(rawInput, createTemplateSchema.parse)
    const scope = resolveCommandScope(ctx)
    validateDescriptorCurrencies(parsed.gatewayProviderKey, deriveConfiguredCurrencies(parsed))
    const em = ctx.container.resolve('em') as EntityManager
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    const template = em.create(CheckoutLinkTemplate, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      ...parsed,
      fixedPriceAmount: toMoneyString(parsed.fixedPriceAmount),
      fixedPriceOriginalAmount: toMoneyString(parsed.fixedPriceOriginalAmount),
      customAmountMin: toMoneyString(parsed.customAmountMin),
      customAmountMax: toMoneyString(parsed.customAmountMax),
      passwordHash: await hashCheckoutPassword(parsed.password),
    })
    em.persist(template)
    await em.flush()
    await setCustomFieldsIfAny({
      dataEngine,
      entityId: CHECKOUT_ENTITY_IDS.template,
      recordId: template.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      values: customFields,
    })
    return { id: template.id }
  },
}

const updateTemplateCommand: CommandHandler<Record<string, unknown>, { ok: true }> = {
  id: 'checkout.template.update',
  async execute(rawInput, ctx) {
    const { parsed, customFields } = parseCheckoutInput(rawInput, updateTemplateSchema.parse)
    const scope = resolveCommandScope(ctx)
    validateDescriptorCurrencies(parsed.gatewayProviderKey ?? null, deriveConfiguredCurrencies(parsed))
    const em = ctx.container.resolve('em') as EntityManager
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    const template = await em.findOne(CheckoutLinkTemplate, {
      id: parsed.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    if (!template) throw new CrudHttpError(404, { error: 'Template not found' })
    const passwordHash = parsed.password !== undefined
      ? await hashCheckoutPassword(parsed.password)
      : template.passwordHash
    Object.assign(template, {
      ...parsed,
      fixedPriceAmount: parsed.fixedPriceAmount !== undefined ? toMoneyString(parsed.fixedPriceAmount) : template.fixedPriceAmount,
      fixedPriceOriginalAmount: parsed.fixedPriceOriginalAmount !== undefined ? toMoneyString(parsed.fixedPriceOriginalAmount) : template.fixedPriceOriginalAmount,
      customAmountMin: parsed.customAmountMin !== undefined ? toMoneyString(parsed.customAmountMin) : template.customAmountMin,
      customAmountMax: parsed.customAmountMax !== undefined ? toMoneyString(parsed.customAmountMax) : template.customAmountMax,
      passwordHash,
    })
    await em.flush()
    await setCustomFieldsIfAny({
      dataEngine,
      entityId: CHECKOUT_ENTITY_IDS.template,
      recordId: template.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      values: customFields,
    })
    return { ok: true }
  },
}

const deleteTemplateCommand: CommandHandler<Record<string, unknown>, { ok: true }> = {
  id: 'checkout.template.delete',
  async execute(rawInput, ctx) {
    const templateId = readCommandId(rawInput, 'Template id is required')
    const scope = resolveCommandScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const template = await em.findOne(CheckoutLinkTemplate, {
      id: templateId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    if (!template) throw new CrudHttpError(404, { error: 'Template not found' })
    template.deletedAt = new Date()
    await em.flush()
    return { ok: true }
  },
}

registerCommand(createTemplateCommand)
registerCommand(updateTemplateCommand)
registerCommand(deleteTemplateCommand)

export function serializeTemplateRecord(record: CheckoutLinkTemplate) {
  return serializeTemplateOrLink(record)
}
