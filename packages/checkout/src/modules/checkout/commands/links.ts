import type { EntityManager } from '@mikro-orm/postgresql'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { buildCustomFieldResetMap, loadCustomFieldSnapshot } from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { setCustomFieldsIfAny } from '@open-mercato/shared/lib/commands/helpers'
import { loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CheckoutLink, CheckoutLinkTemplate, CheckoutTransaction } from '../data/entities'
import { createLinkSchema, updateLinkSchema } from '../data/validators'
import { CHECKOUT_ENTITY_IDS } from '../lib/constants'
import {
  ensureGatewayProviderConfigured,
  type PaymentGatewayDescriptorService,
} from '../lib/gatewayProviderAvailability'
import { emitCheckoutEvent } from '../events'
import {
  deriveConfiguredCurrencies,
  ensureUniqueSlug,
  hashCheckoutPassword,
  isCheckoutLinkPublic,
  parseCheckoutInput,
  pickExplicitParsedOverrides,
  resolveLoadedCheckoutCustomFields,
  serializeTemplateOrLink,
  toMoneyString,
  toTemplateOrLinkMutationInput,
  validateDescriptorCurrencies,
} from '../lib/utils'
import {
  captureLinkSnapshot,
  createLinkFromSnapshot,
  extractUndoPayload,
  readCommandId,
  resolveCommandScope,
  restoreLinkFromSnapshot,
  toCheckoutAuditSnapshot,
  type CheckoutLinkSnapshot,
} from './shared'

const ACTIVE_TRANSACTION_STATUSES = ['pending', 'processing']

type CheckoutLinkUndoPayload = {
  before?: CheckoutLinkSnapshot | null
  after?: CheckoutLinkSnapshot | null
}

async function resolveRestoredLinkSlug(
  em: EntityManager,
  snapshot: CheckoutLinkSnapshot,
): Promise<string> {
  return ensureUniqueSlug(
    em,
    {
      tenantId: snapshot.tenantId,
      organizationId: snapshot.organizationId,
    },
    snapshot.slug,
    snapshot.title ?? snapshot.name,
    snapshot.id,
  )
}

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
        ...pickExplicitParsedOverrides(rawInput, parsed),
        templateId: template.id,
      })
      const loaded = await loadCustomFieldValues({
        em,
        entityId: CHECKOUT_ENTITY_IDS.template,
        recordIds: [template.id],
        tenantIdByRecord: { [template.id]: scope.tenantId },
        organizationIdByRecord: { [template.id]: scope.organizationId },
      })
      templateCustomFields = resolveLoadedCheckoutCustomFields(loaded[template.id])
    }

    validateDescriptorCurrencies(sourceValues.gatewayProviderKey ?? null, deriveConfiguredCurrencies(sourceValues))
    const descriptorService = ctx.container.resolve('paymentGatewayDescriptorService') as PaymentGatewayDescriptorService
    await ensureGatewayProviderConfigured(sourceValues.gatewayProviderKey ?? null, descriptorService, scope)
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
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const link = await findOneWithDecryption(em, CheckoutLink, { id: result.id })
    if (!link) return null
    const custom = await loadCustomFieldSnapshot(em, {
      entityId: CHECKOUT_ENTITY_IDS.link,
      recordId: link.id,
      tenantId: link.tenantId,
      organizationId: link.organizationId,
    })
    return captureLinkSnapshot(link, custom)
  },
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const after = snapshots.after as CheckoutLinkSnapshot | null | undefined
    return {
      actionLabel: translate('checkout.audit.links.create', 'Create pay link'),
      resourceKind: 'checkout.link',
      resourceId: result.id,
      tenantId: after?.tenantId ?? null,
      organizationId: after?.organizationId ?? null,
      snapshotAfter: after ? toCheckoutAuditSnapshot(after) : null,
      payload: {
        undo: {
          after: after ?? null,
        } satisfies CheckoutLinkUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const after = extractUndoPayload<CheckoutLinkUndoPayload>(logEntry)?.after
    if (!after) return
    const em = ctx.container.resolve('em') as EntityManager
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    const reset = buildCustomFieldResetMap(undefined, after.custom)
    if (Object.keys(reset).length) {
      await setCustomFieldsIfAny({
        dataEngine,
        entityId: CHECKOUT_ENTITY_IDS.link,
        recordId: after.id,
        tenantId: after.tenantId,
        organizationId: after.organizationId,
        values: reset,
        notify: false,
      })
    }
    const link = await em.findOne(CheckoutLink, { id: after.id })
    if (!link) return
    link.deletedAt = new Date()
    await em.flush()
  },
}

const updateLinkCommand: CommandHandler<Record<string, unknown>, { ok: true; slug: string }> = {
  id: 'checkout.link.update',
  async prepare(rawInput, ctx) {
    const { parsed } = parseCheckoutInput(rawInput, updateLinkSchema.parse)
    const scope = resolveCommandScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const link = await findOneWithDecryption(em, CheckoutLink, {
      id: parsed.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    }, undefined, scope)
    if (!link) return {}
    const custom = await loadCustomFieldSnapshot(em, {
      entityId: CHECKOUT_ENTITY_IDS.link,
      recordId: link.id,
      tenantId: link.tenantId,
      organizationId: link.organizationId,
    })
    return { before: captureLinkSnapshot(link, custom) }
  },
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
    const descriptorService = ctx.container.resolve('paymentGatewayDescriptorService') as PaymentGatewayDescriptorService
    await ensureGatewayProviderConfigured(nextValues.gatewayProviderKey ?? null, descriptorService, scope)
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
    return { ok: true, slug: link.slug }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const link = await findOneWithDecryption(em, CheckoutLink, { slug: result.slug, deletedAt: null })
    if (!link) return null
    const custom = await loadCustomFieldSnapshot(em, {
      entityId: CHECKOUT_ENTITY_IDS.link,
      recordId: link.id,
      tenantId: link.tenantId,
      organizationId: link.organizationId,
    })
    return captureLinkSnapshot(link, custom)
  },
  buildLog: async ({ snapshots, result }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as CheckoutLinkSnapshot | null | undefined
    const after = snapshots.after as CheckoutLinkSnapshot | null | undefined
    return {
      actionLabel: translate('checkout.audit.links.update', 'Update pay link'),
      resourceKind: 'checkout.link',
      resourceId: after?.id ?? before?.id ?? null,
      tenantId: after?.tenantId ?? before?.tenantId ?? null,
      organizationId: after?.organizationId ?? before?.organizationId ?? null,
      snapshotBefore: before ? toCheckoutAuditSnapshot(before) : null,
      snapshotAfter: after ? toCheckoutAuditSnapshot(after) : null,
      payload: {
        undo: {
          before: before ?? null,
          after: after ?? null,
        } satisfies CheckoutLinkUndoPayload,
      },
      context: result.slug ? { slug: result.slug } : null,
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const undo = extractUndoPayload<CheckoutLinkUndoPayload>(logEntry)
    const before = undo?.before
    const after = undo?.after
    if (!before) return
    const em = ctx.container.resolve('em') as EntityManager
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    const link = await em.findOne(CheckoutLink, { id: before.id, deletedAt: null })
    if (!link) return
    restoreLinkFromSnapshot(link, before)
    link.slug = await resolveRestoredLinkSlug(em, before)
    await em.flush()
    const reset = buildCustomFieldResetMap(before.custom, after?.custom)
    if (Object.keys(reset).length) {
      await setCustomFieldsIfAny({
        dataEngine,
        entityId: CHECKOUT_ENTITY_IDS.link,
        recordId: before.id,
        tenantId: before.tenantId,
        organizationId: before.organizationId,
        values: reset,
        notify: false,
      })
    }
  },
}

const deleteLinkCommand: CommandHandler<Record<string, unknown>, { ok: true }> = {
  id: 'checkout.link.delete',
  async prepare(rawInput, ctx) {
    const linkId = readCommandId(rawInput, 'Link id is required')
    const scope = resolveCommandScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const link = await findOneWithDecryption(em, CheckoutLink, {
      id: linkId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    }, undefined, scope)
    if (!link) return {}
    const custom = await loadCustomFieldSnapshot(em, {
      entityId: CHECKOUT_ENTITY_IDS.link,
      recordId: link.id,
      tenantId: link.tenantId,
      organizationId: link.organizationId,
    })
    return { before: captureLinkSnapshot(link, custom) }
  },
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
  buildLog: async ({ snapshots, input }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as CheckoutLinkSnapshot | null | undefined
    return {
      actionLabel: translate('checkout.audit.links.delete', 'Delete pay link'),
      resourceKind: 'checkout.link',
      resourceId: before?.id ?? readCommandId(input, 'Link id is required'),
      tenantId: before?.tenantId ?? null,
      organizationId: before?.organizationId ?? null,
      snapshotBefore: before ? toCheckoutAuditSnapshot(before) : null,
      payload: {
        undo: {
          before: before ?? null,
        } satisfies CheckoutLinkUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<CheckoutLinkUndoPayload>(logEntry)?.before
    if (!before) return
    const em = ctx.container.resolve('em') as EntityManager
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    let link = await em.findOne(CheckoutLink, { id: before.id })
    if (link) {
      restoreLinkFromSnapshot(link, before)
      link.slug = await resolveRestoredLinkSlug(em, before)
    } else {
      link = em.create(CheckoutLink, {
        ...createLinkFromSnapshot(before),
        slug: await resolveRestoredLinkSlug(em, before),
      })
      em.persist(link)
    }
    await em.flush()
    const reset = buildCustomFieldResetMap(before.custom, undefined)
    if (Object.keys(reset).length) {
      await setCustomFieldsIfAny({
        dataEngine,
        entityId: CHECKOUT_ENTITY_IDS.link,
        recordId: before.id,
        tenantId: before.tenantId,
        organizationId: before.organizationId,
        values: reset,
        notify: false,
      })
    }
  },
}

registerCommand(createLinkCommand)
registerCommand(updateLinkCommand)
registerCommand(deleteLinkCommand)

export function serializeLinkRecord(record: CheckoutLink) {
  return serializeTemplateOrLink(record)
}
