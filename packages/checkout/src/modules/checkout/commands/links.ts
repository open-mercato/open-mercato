import type { EntityManager } from '@mikro-orm/postgresql'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { setCustomFieldsIfAny } from '@open-mercato/shared/lib/commands/helpers'
import { loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CheckoutLink, CheckoutLinkTemplate, CheckoutTransaction } from '../data/entities'
import { createLinkSchema, updateLinkSchema } from '../data/validators'
import { CHECKOUT_ENTITY_IDS } from '../lib/constants'
import { emitCheckoutEvent } from '../events'
import {
  deriveConfiguredCurrencies,
  ensureUniqueSlug,
  hashCheckoutPassword,
  isCheckoutLinkPublic,
  parseCheckoutInput,
  serializeTemplateOrLink,
  toMoneyString,
  toTemplateOrLinkMutationInput,
  validateDescriptorCurrencies,
} from '../lib/utils'
import { readCommandId, resolveCommandScope } from './shared'

const ACTIVE_TRANSACTION_STATUSES = ['pending', 'processing']

const createLinkCommand: CommandHandler<Record<string, unknown>, { id: string; slug: string }> = {
  id: 'checkout.link.create',
  async execute(rawInput, ctx) {
    const { parsed, customFields } = parseCheckoutInput(rawInput, createLinkSchema.parse)
    const scope = resolveCommandScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine

    let sourceValues = parsed
    let templateCustomFields: Record<string, unknown> = {}
    if (parsed.templateId) {
      const template = await findOneWithDecryption(em, CheckoutLinkTemplate, {
        id: parsed.templateId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      }, undefined, scope)
      if (!template) throw new CrudHttpError(404, { error: 'Template not found' })
      sourceValues = toTemplateOrLinkMutationInput(template, {
        ...parsed,
        templateId: template.id,
      })
      const loaded = await loadCustomFieldValues({
        em,
        entityId: CHECKOUT_ENTITY_IDS.template,
        recordIds: [template.id],
        tenantIdByRecord: { [template.id]: scope.tenantId },
        organizationIdByRecord: { [template.id]: scope.organizationId },
      })
      templateCustomFields = loaded[template.id] ?? {}
    }

    validateDescriptorCurrencies(sourceValues.gatewayProviderKey ?? null, deriveConfiguredCurrencies(sourceValues))
    if (isCheckoutLinkPublic(sourceValues.status) && !sourceValues.gatewayProviderKey) {
      throw new CrudHttpError(422, { error: 'A payment gateway must be configured before this link can be published' })
    }
    const slug = await ensureUniqueSlug(
      em,
      scope,
      sourceValues.slug ?? null,
      sourceValues.title ?? sourceValues.name,
    )
    const link = em.create(CheckoutLink, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      completionCount: 0,
      activeReservationCount: 0,
      isLocked: false,
      ...sourceValues,
      fixedPriceAmount: toMoneyString(sourceValues.fixedPriceAmount),
      fixedPriceOriginalAmount: toMoneyString(sourceValues.fixedPriceOriginalAmount),
      customAmountMin: toMoneyString(sourceValues.customAmountMin),
      customAmountMax: toMoneyString(sourceValues.customAmountMax),
      slug,
      passwordHash: await hashCheckoutPassword(sourceValues.password),
    })
    em.persist(link)
    await em.flush()
    await setCustomFieldsIfAny({
      dataEngine,
      entityId: CHECKOUT_ENTITY_IDS.link,
      recordId: link.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      values: { ...templateCustomFields, ...customFields },
    })
    await emitCheckoutEvent('checkout.link.created', {
      id: link.id,
      slug: link.slug,
      status: link.status,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }).catch(() => undefined)
    if (link.status === 'active') {
      await emitCheckoutEvent('checkout.link.published', {
        id: link.id,
        slug: link.slug,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      }).catch(() => undefined)
    }
    return { id: link.id, slug: link.slug }
  },
}

const updateLinkCommand: CommandHandler<Record<string, unknown>, { ok: true }> = {
  id: 'checkout.link.update',
  async execute(rawInput, ctx) {
    const { parsed, customFields } = parseCheckoutInput(rawInput, updateLinkSchema.parse)
    const scope = resolveCommandScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    const link = await findOneWithDecryption(em, CheckoutLink, {
      id: parsed.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    }, undefined, scope)
    if (!link) throw new CrudHttpError(404, { error: 'Link not found' })
    if (link.isLocked) {
      throw new CrudHttpError(422, { error: 'This link has active transactions and cannot be edited' })
    }
    const nextValues = toTemplateOrLinkMutationInput(link, parsed)
    validateDescriptorCurrencies(
      parsed.gatewayProviderKey ?? link.gatewayProviderKey ?? null,
      deriveConfiguredCurrencies(nextValues),
    )
    if (isCheckoutLinkPublic(nextValues.status) && !nextValues.gatewayProviderKey) {
      throw new CrudHttpError(422, { error: 'A payment gateway must be configured before this link can be published' })
    }
    const slug = parsed.slug !== undefined || parsed.name !== undefined || parsed.title !== undefined
      ? await ensureUniqueSlug(em, scope, parsed.slug ?? link.slug, parsed.title ?? parsed.name ?? link.title ?? link.name, link.id)
      : link.slug
    const passwordHash = parsed.password !== undefined ? await hashCheckoutPassword(parsed.password) : link.passwordHash
    const previousStatus = link.status
    Object.assign(link, {
      ...parsed,
      fixedPriceAmount: parsed.fixedPriceAmount !== undefined ? toMoneyString(parsed.fixedPriceAmount) : link.fixedPriceAmount,
      fixedPriceOriginalAmount: parsed.fixedPriceOriginalAmount !== undefined ? toMoneyString(parsed.fixedPriceOriginalAmount) : link.fixedPriceOriginalAmount,
      customAmountMin: parsed.customAmountMin !== undefined ? toMoneyString(parsed.customAmountMin) : link.customAmountMin,
      customAmountMax: parsed.customAmountMax !== undefined ? toMoneyString(parsed.customAmountMax) : link.customAmountMax,
      slug,
      passwordHash,
    })
    await em.flush()
    await setCustomFieldsIfAny({
      dataEngine,
      entityId: CHECKOUT_ENTITY_IDS.link,
      recordId: link.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      values: customFields,
    })
    await emitCheckoutEvent('checkout.link.updated', {
      id: link.id,
      slug: link.slug,
      status: link.status,
      previousStatus,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }).catch(() => undefined)
    if (previousStatus !== 'active' && link.status === 'active') {
      await emitCheckoutEvent('checkout.link.published', {
        id: link.id,
        slug: link.slug,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      }).catch(() => undefined)
    }
    return { ok: true }
  },
}

const deleteLinkCommand: CommandHandler<Record<string, unknown>, { ok: true }> = {
  id: 'checkout.link.delete',
  async execute(rawInput, ctx) {
    const linkId = readCommandId(rawInput, 'Link id is required')
    const scope = resolveCommandScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const link = await findOneWithDecryption(em, CheckoutLink, {
      id: linkId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    }, undefined, scope)
    if (!link) throw new CrudHttpError(404, { error: 'Link not found' })
    const activeCount = await em.count(CheckoutTransaction, {
      linkId: link.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      status: { $in: ACTIVE_TRANSACTION_STATUSES as Array<CheckoutTransaction['status']> },
    })
    if (activeCount > 0) {
      throw new CrudHttpError(422, { error: 'This link has active transactions and cannot be deleted' })
    }
    link.deletedAt = new Date()
    await em.flush()
    await emitCheckoutEvent('checkout.link.deleted', {
      id: link.id,
      slug: link.slug,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }).catch(() => undefined)
    return { ok: true }
  },
}

registerCommand(createLinkCommand)
registerCommand(updateLinkCommand)
registerCommand(deleteLinkCommand)

export function serializeLinkRecord(record: CheckoutLink) {
  return serializeTemplateOrLink(record)
}
