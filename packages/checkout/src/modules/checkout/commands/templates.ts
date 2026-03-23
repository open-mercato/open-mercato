import type { EntityManager } from '@mikro-orm/postgresql'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { buildCustomFieldResetMap, loadCustomFieldSnapshot } from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { setCustomFieldsIfAny } from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CheckoutLink, CheckoutLinkTemplate } from '../data/entities'
import { createTemplateSchema, updateTemplateSchema } from '../data/validators'
import { CHECKOUT_ENTITY_IDS } from '../lib/constants'
import {
  ensureGatewayProviderConfigured,
  type PaymentGatewayDescriptorService,
} from '../lib/gatewayProviderAvailability'
import { emitCheckoutEvent } from '../events'
import {
  deriveConfiguredCurrencies,
  hashCheckoutPassword,
  parseCheckoutInput,
  serializeTemplateOrLink,
  toMoneyString,
  validateDescriptorCurrencies,
} from '../lib/utils'
import {
  buildSelectiveLinkedCustomFieldUpdates,
  buildSelectiveLinkedLinkSnapshot,
  captureTemplateSnapshot,
  createTemplateFromSnapshot,
  extractUndoPayload,
  captureLinkSnapshot,
  readCommandId,
  resolveCommandScope,
  restoreLinkFromSnapshot,
  restoreTemplateFromSnapshot,
  toCheckoutAuditSnapshot,
  type CheckoutTemplateSnapshot,
} from './shared'

type CheckoutTemplateUndoPayload = {
  before?: CheckoutTemplateSnapshot | null
  after?: CheckoutTemplateSnapshot | null
}

async function syncLinkedLinksWithTemplateSnapshot(params: {
  em: EntityManager
  dataEngine: DataEngine
  scope: { organizationId: string; tenantId: string }
  templateId: string
  before: CheckoutTemplateSnapshot
  after: CheckoutTemplateSnapshot
}) {
  const { em, dataEngine, scope, templateId, before, after } = params
  const linkedLinks = await findWithDecryption(
    em,
    CheckoutLink,
    {
      templateId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
      isLocked: false,
    },
    undefined,
    scope,
  )

  let changedLinks = false

  for (const link of linkedLinks) {
    const currentLinkSnapshot = captureLinkSnapshot(link)
    const nextLinkSnapshot = buildSelectiveLinkedLinkSnapshot(currentLinkSnapshot, before, after)
    if (nextLinkSnapshot.changed) {
      restoreLinkFromSnapshot(link, nextLinkSnapshot.snapshot)
      changedLinks = true
    }

    const currentCustom = await loadCustomFieldSnapshot(em, {
      entityId: CHECKOUT_ENTITY_IDS.link,
      recordId: link.id,
      tenantId: link.tenantId,
      organizationId: link.organizationId,
    })
    const customFieldUpdates = buildSelectiveLinkedCustomFieldUpdates(currentCustom, before.custom, after.custom)
    if (Object.keys(customFieldUpdates).length > 0) {
      await setCustomFieldsIfAny({
        dataEngine,
        entityId: CHECKOUT_ENTITY_IDS.link,
        recordId: link.id,
        tenantId: link.tenantId,
        organizationId: link.organizationId,
        values: customFieldUpdates,
      })
    }
  }

  if (changedLinks) {
    await em.flush()
  }
}

const createTemplateCommand: CommandHandler<Record<string, unknown>, { id: string }> = {
  id: 'checkout.template.create',
  async execute(rawInput, ctx) {
    const { parsed, customFields } = parseCheckoutInput(rawInput, createTemplateSchema.parse)
    const scope = resolveCommandScope(ctx)
    validateDescriptorCurrencies(parsed.gatewayProviderKey, deriveConfiguredCurrencies(parsed))
    const descriptorService = ctx.container.resolve('paymentGatewayDescriptorService') as PaymentGatewayDescriptorService
    await ensureGatewayProviderConfigured(parsed.gatewayProviderKey, descriptorService, scope)
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
    await emitCheckoutEvent('checkout.template.created', {
      id: template.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }).catch(() => undefined)
    return { id: template.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const template = await findOneWithDecryption(em, CheckoutLinkTemplate, { id: result.id })
    if (!template) return null
    const custom = await loadCustomFieldSnapshot(em, {
      entityId: CHECKOUT_ENTITY_IDS.template,
      recordId: template.id,
      tenantId: template.tenantId,
      organizationId: template.organizationId,
    })
    return captureTemplateSnapshot(template, custom)
  },
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const after = snapshots.after as CheckoutTemplateSnapshot | null | undefined
    return {
      actionLabel: translate('checkout.audit.templates.create', 'Create pay-link template'),
      resourceKind: 'checkout.template',
      resourceId: result.id,
      tenantId: after?.tenantId ?? null,
      organizationId: after?.organizationId ?? null,
      snapshotAfter: after ? toCheckoutAuditSnapshot(after) : null,
      payload: {
        undo: {
          after: after ?? null,
        } satisfies CheckoutTemplateUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const after = extractUndoPayload<CheckoutTemplateUndoPayload>(logEntry)?.after
    if (!after) return
    const em = ctx.container.resolve('em') as EntityManager
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    const reset = buildCustomFieldResetMap(undefined, after.custom)
    if (Object.keys(reset).length) {
      await setCustomFieldsIfAny({
        dataEngine,
        entityId: CHECKOUT_ENTITY_IDS.template,
        recordId: after.id,
        tenantId: after.tenantId,
        organizationId: after.organizationId,
        values: reset,
        notify: false,
      })
    }
    const template = await em.findOne(CheckoutLinkTemplate, { id: after.id })
    if (!template) return
    template.deletedAt = new Date()
    await em.flush()
  },
}

const updateTemplateCommand: CommandHandler<Record<string, unknown>, { ok: true }> = {
  id: 'checkout.template.update',
  async prepare(rawInput, ctx) {
    const { parsed } = parseCheckoutInput(rawInput, updateTemplateSchema.parse)
    const scope = resolveCommandScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const template = await findOneWithDecryption(em, CheckoutLinkTemplate, {
      id: parsed.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    }, undefined, scope)
    if (!template) return {}
    const custom = await loadCustomFieldSnapshot(em, {
      entityId: CHECKOUT_ENTITY_IDS.template,
      recordId: template.id,
      tenantId: template.tenantId,
      organizationId: template.organizationId,
    })
    return { before: captureTemplateSnapshot(template, custom) }
  },
  async execute(rawInput, ctx) {
    const { parsed, customFields } = parseCheckoutInput(rawInput, updateTemplateSchema.parse)
    const scope = resolveCommandScope(ctx)
    validateDescriptorCurrencies(parsed.gatewayProviderKey ?? null, deriveConfiguredCurrencies(parsed))
    const descriptorService = ctx.container.resolve('paymentGatewayDescriptorService') as PaymentGatewayDescriptorService
    await ensureGatewayProviderConfigured(parsed.gatewayProviderKey ?? null, descriptorService, scope)
    const em = ctx.container.resolve('em') as EntityManager
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    const template = await findOneWithDecryption(em, CheckoutLinkTemplate, {
      id: parsed.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    }, undefined, scope)
    if (!template) throw new CrudHttpError(404, { error: 'Template not found' })
    const beforeCustom = await loadCustomFieldSnapshot(em, {
      entityId: CHECKOUT_ENTITY_IDS.template,
      recordId: template.id,
      tenantId: template.tenantId,
      organizationId: template.organizationId,
    })
    const beforeSnapshot = captureTemplateSnapshot(template, beforeCustom)
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
    const afterCustom = await loadCustomFieldSnapshot(em, {
      entityId: CHECKOUT_ENTITY_IDS.template,
      recordId: template.id,
      tenantId: template.tenantId,
      organizationId: template.organizationId,
    })
    const afterSnapshot = captureTemplateSnapshot(template, afterCustom)
    await syncLinkedLinksWithTemplateSnapshot({
      em,
      dataEngine,
      scope,
      templateId: template.id,
      before: beforeSnapshot,
      after: afterSnapshot,
    })
    await emitCheckoutEvent('checkout.template.updated', {
      id: template.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }).catch(() => undefined)
    return { ok: true }
  },
  captureAfter: async (input, _result, ctx) => {
    const { parsed } = parseCheckoutInput(input, updateTemplateSchema.parse)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const template = await findOneWithDecryption(em, CheckoutLinkTemplate, { id: parsed.id, deletedAt: null })
    if (!template) return null
    const custom = await loadCustomFieldSnapshot(em, {
      entityId: CHECKOUT_ENTITY_IDS.template,
      recordId: template.id,
      tenantId: template.tenantId,
      organizationId: template.organizationId,
    })
    return captureTemplateSnapshot(template, custom)
  },
  buildLog: async ({ snapshots, input }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as CheckoutTemplateSnapshot | null | undefined
    const after = snapshots.after as CheckoutTemplateSnapshot | null | undefined
    return {
      actionLabel: translate('checkout.audit.templates.update', 'Update pay-link template'),
      resourceKind: 'checkout.template',
      resourceId: after?.id ?? before?.id ?? readCommandId(input, 'Template id is required'),
      tenantId: after?.tenantId ?? before?.tenantId ?? null,
      organizationId: after?.organizationId ?? before?.organizationId ?? null,
      snapshotBefore: before ? toCheckoutAuditSnapshot(before) : null,
      snapshotAfter: after ? toCheckoutAuditSnapshot(after) : null,
      payload: {
        undo: {
          before: before ?? null,
          after: after ?? null,
        } satisfies CheckoutTemplateUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const undo = extractUndoPayload<CheckoutTemplateUndoPayload>(logEntry)
    const before = undo?.before
    const after = undo?.after
    if (!before) return
    const em = ctx.container.resolve('em') as EntityManager
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    const template = await em.findOne(CheckoutLinkTemplate, { id: before.id, deletedAt: null })
    if (!template) return
    restoreTemplateFromSnapshot(template, before)
    await em.flush()
    const reset = buildCustomFieldResetMap(before.custom, after?.custom)
    if (Object.keys(reset).length) {
      await setCustomFieldsIfAny({
        dataEngine,
        entityId: CHECKOUT_ENTITY_IDS.template,
        recordId: before.id,
        tenantId: before.tenantId,
        organizationId: before.organizationId,
        values: reset,
        notify: false,
      })
    }
    if (after) {
      await syncLinkedLinksWithTemplateSnapshot({
        em,
        dataEngine,
        scope: { organizationId: before.organizationId, tenantId: before.tenantId },
        templateId: before.id,
        before: after,
        after: before,
      })
    }
  },
}

const deleteTemplateCommand: CommandHandler<Record<string, unknown>, { ok: true }> = {
  id: 'checkout.template.delete',
  async prepare(rawInput, ctx) {
    const templateId = readCommandId(rawInput, 'Template id is required')
    const scope = resolveCommandScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const template = await findOneWithDecryption(em, CheckoutLinkTemplate, {
      id: templateId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    }, undefined, scope)
    if (!template) return {}
    const custom = await loadCustomFieldSnapshot(em, {
      entityId: CHECKOUT_ENTITY_IDS.template,
      recordId: template.id,
      tenantId: template.tenantId,
      organizationId: template.organizationId,
    })
    return { before: captureTemplateSnapshot(template, custom) }
  },
  async execute(rawInput, ctx) {
    const templateId = readCommandId(rawInput, 'Template id is required')
    const scope = resolveCommandScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const template = await findOneWithDecryption(em, CheckoutLinkTemplate, {
      id: templateId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    }, undefined, scope)
    if (!template) throw new CrudHttpError(404, { error: 'Template not found' })
    template.deletedAt = new Date()
    await em.flush()
    await emitCheckoutEvent('checkout.template.deleted', {
      id: template.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }).catch(() => undefined)
    return { ok: true }
  },
  buildLog: async ({ snapshots, input }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as CheckoutTemplateSnapshot | null | undefined
    return {
      actionLabel: translate('checkout.audit.templates.delete', 'Delete pay-link template'),
      resourceKind: 'checkout.template',
      resourceId: before?.id ?? readCommandId(input, 'Template id is required'),
      tenantId: before?.tenantId ?? null,
      organizationId: before?.organizationId ?? null,
      snapshotBefore: before ? toCheckoutAuditSnapshot(before) : null,
      payload: {
        undo: {
          before: before ?? null,
        } satisfies CheckoutTemplateUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<CheckoutTemplateUndoPayload>(logEntry)?.before
    if (!before) return
    const em = ctx.container.resolve('em') as EntityManager
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    let template = await em.findOne(CheckoutLinkTemplate, { id: before.id })
    if (template) {
      restoreTemplateFromSnapshot(template, before)
    } else {
      template = em.create(CheckoutLinkTemplate, createTemplateFromSnapshot(before))
      em.persist(template)
    }
    await em.flush()
    const reset = buildCustomFieldResetMap(before.custom, undefined)
    if (Object.keys(reset).length) {
      await setCustomFieldsIfAny({
        dataEngine,
        entityId: CHECKOUT_ENTITY_IDS.template,
        recordId: before.id,
        tenantId: before.tenantId,
        organizationId: before.organizationId,
        values: reset,
        notify: false,
      })
    }
  },
}

registerCommand(createTemplateCommand)
registerCommand(updateTemplateCommand)
registerCommand(deleteTemplateCommand)

export function serializeTemplateRecord(record: CheckoutLinkTemplate) {
  return serializeTemplateOrLink(record)
}
