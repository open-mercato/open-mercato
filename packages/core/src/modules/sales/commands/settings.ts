import { LockMode } from '@mikro-orm/core'
import { z } from 'zod'
import { buildOptimisticLockConflictBody, enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { DEFAULT_ORDER_NUMBER_FORMAT, DEFAULT_QUOTE_NUMBER_FORMAT } from '../lib/documentNumberTokens'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext, CommandUndoLogEntry } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { SalesSettings } from '../data/entities'
import { salesSettingsUpsertSchema, quoteValiditySettingsSaveSchema, type QuoteValiditySettingsSaveInput, type SalesSettingsUpsertInput } from '../data/validators'
import { ensureOrganizationScope, ensureTenantScope } from './shared'
import { SalesDocumentNumberGenerator } from '../services/salesDocumentNumberGenerator'

async function ensureNumberEditPermission(
  ctx: CommandRuntimeContext,
  scope: { tenantId: string; organizationId: string }
) {
  const rbac = ctx.container.resolve('rbacService') as RbacService | null
  const auth = ctx.auth
  if (!rbac || !auth?.sub) return
  const ok = await rbac.userHasAllFeatures(auth.sub, ['sales.documents.number.edit'], scope)
  if (!ok) {
    const { translate } = await resolveTranslations()
    throw new CrudHttpError(403, {
      error: translate('sales.documents.errors.number_edit_forbidden', 'Document number cannot be edited.'),
    })
  }
}

export async function loadSalesSettings(
  em: EntityManager,
  params: { tenantId: string; organizationId: string },
  options: { lockMode?: LockMode } = {},
): Promise<SalesSettings | null> {
  return findOneWithDecryption(em, SalesSettings, {
    tenantId: params.tenantId,
    organizationId: params.organizationId,
  }, options, params)
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
      await ensureNumberEditPermission(ctx, { tenantId: input.tenantId, organizationId: input.organizationId })
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

const quoteValidityReplayScopeSchema = quoteValiditySettingsSaveSchema.pick({ tenantId: true, organizationId: true })

const quoteValiditySnapshotSchema = z.object({
  id: z.string().uuid(),
  defaultQuoteValidityDays: z.number().int().min(1).max(365),
  updatedAt: z.string().datetime(),
})

type QuoteValiditySnapshot = z.infer<typeof quoteValiditySnapshotSchema>
type QuoteValiditySaveResult = Omit<QuoteValiditySnapshot, 'id'> & { before: QuoteValiditySnapshot }

function snapshotQuoteValidity(settings: SalesSettings): QuoteValiditySnapshot {
  return {
    id: settings.id,
    defaultQuoteValidityDays: settings.defaultQuoteValidityDays,
    updatedAt: settings.updatedAt.toISOString(),
  }
}

async function writeQuoteValidity(
  em: EntityManager,
  settings: SalesSettings,
  days: number,
): Promise<QuoteValiditySaveResult> {
  const before = snapshotQuoteValidity(settings)
  settings.defaultQuoteValidityDays = days
  settings.updatedAt = new Date(Math.max(Date.now(), settings.updatedAt.getTime() + 1))
  await em.flush()
  return { defaultQuoteValidityDays: days, updatedAt: settings.updatedAt.toISOString(), before }
}

async function replayQuoteValidity(
  ctx: CommandRuntimeContext,
  logEntry: CommandUndoLogEntry,
  undo: boolean,
): Promise<QuoteValiditySaveResult> {
  const scope = quoteValidityReplayScopeSchema.parse(logEntry)
  ensureTenantScope(ctx, scope.tenantId)
  ensureOrganizationScope(ctx, scope.organizationId)
  const expected = quoteValiditySnapshotSchema.parse(undo ? logEntry.snapshotAfter : logEntry.snapshotBefore)
  const target = quoteValiditySnapshotSchema.parse(undo ? logEntry.snapshotBefore : logEntry.snapshotAfter)
  const em = ctx.transactionalEm
  if (!em) throw new Error('[internal] Quote validity replay requires a transaction')
  const settings = await loadSalesSettings(em, scope, { lockMode: LockMode.PESSIMISTIC_WRITE })
  if (!settings || settings.id !== expected.id) {
    const { translate } = await resolveTranslations()
    throw new CrudHttpError(404, { error: translate('sales.settings.errors.load_failed', 'Failed to load sales settings') })
  }
  const actualVersion = settings.updatedAt.toISOString()
  if (settings.defaultQuoteValidityDays !== expected.defaultQuoteValidityDays || (undo && actualVersion !== expected.updatedAt)) {
    throw new CrudHttpError(409, buildOptimisticLockConflictBody(actualVersion, expected.updatedAt))
  }
  await enforceCommandOptimisticLockWithGuards(ctx.container, {
    resourceKind: 'sales.settings', resourceId: settings.id, current: settings.updatedAt, request: ctx.request,
  })
  return writeQuoteValidity(em, settings, target.defaultQuoteValidityDays)
}

const saveQuoteValiditySettingsCommand: CommandHandler<QuoteValiditySettingsSaveInput, QuoteValiditySaveResult> = {
  id: 'sales.settings.quote_validity.save',
  atomicReplay: true,
  async authorizeReplay({ logEntry, ctx }) {
    const scope = quoteValidityReplayScopeSchema.parse(logEntry)
    ensureTenantScope(ctx, scope.tenantId)
    ensureOrganizationScope(ctx, scope.organizationId)
    const rbac = ctx.container.resolve('rbacService') as RbacService
    if (!ctx.auth?.sub || !(await rbac.userHasAllFeatures(ctx.auth.sub, ['sales.settings.manage'], scope))) {
      const { translate } = await resolveTranslations()
      throw new CrudHttpError(403, { error: translate('sales.documents.errors.forbidden', 'Forbidden') })
    }
  },
  async execute(rawInput, ctx) {
    const input = quoteValiditySettingsSaveSchema.parse(rawInput)
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return em.transactional(async (transactionEm) => {
      let settings = await loadSalesSettings(transactionEm, input, { lockMode: LockMode.PESSIMISTIC_WRITE })
      if (!settings) {
        await transactionEm.upsert(SalesSettings, {
          tenantId: input.tenantId, organizationId: input.organizationId,
          orderNumberFormat: DEFAULT_ORDER_NUMBER_FORMAT, quoteNumberFormat: DEFAULT_QUOTE_NUMBER_FORMAT,
          updatedAt: new Date(),
        }, { onConflictFields: ['organizationId', 'tenantId'], onConflictAction: 'ignore' })
        settings = await loadSalesSettings(transactionEm, input, { lockMode: LockMode.PESSIMISTIC_WRITE })
      }
      if (!settings) throw new Error('[internal] Sales settings initialization failed')
      await enforceCommandOptimisticLockWithGuards(ctx.container, {
        resourceKind: 'sales.settings', resourceId: settings.id,
        current: settings.updatedAt, request: ctx.request,
      })
      return writeQuoteValidity(transactionEm, settings, input.defaultQuoteValidityDays)
    })
  },
  async buildLog({ input, result }) {
    const { before, defaultQuoteValidityDays, updatedAt } = result
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('sales.config.quoteValidity.title', 'Quote validity'),
      resourceKind: 'sales.settings', resourceId: before.id,
      organizationId: input.organizationId, tenantId: input.tenantId,
      snapshotBefore: before, snapshotAfter: { id: before.id, defaultQuoteValidityDays, updatedAt },
    }
  },
  async undo({ ctx, logEntry }) {
    await replayQuoteValidity(ctx, logEntry, true)
  },
  async redo({ ctx, logEntry }) {
    return replayQuoteValidity(ctx, logEntry, false)
  },
}

registerCommand(saveQuoteValiditySettingsCommand)
