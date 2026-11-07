import { z } from 'zod'
import { asValue } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { runWithCacheTenant } from '@open-mercato/cache'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards, enforceRecordGoneIsConflict } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { invalidateCrudCache, resolveCrudCache } from '@open-mercato/shared/lib/crud/cache'
import { deriveCrudSegmentTag } from '@open-mercato/shared/lib/crud/cache-stats'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createModuleConfigService, type ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { requireTenantDealStatusManageAccess } from '../lib/dealStatusVocabularyAccess'
import { enforceDealStatusReclassification } from '../lib/dealStatusReclassification'
import { saveDealStatusVocabularySchema } from '../data/dealStatusVocabulary'
export { saveDealStatusVocabularySchema } from '../data/dealStatusVocabulary'
import { DEAL_STATUS_VOCABULARY_CONFIG_KEY, DEAL_STATUS_VOCABULARY_RESOURCE_KIND, resolveDealStatusVocabulary } from '../lib/dealStatusVocabulary'
export { DEAL_STATUS_VOCABULARY_RESOURCE_KIND } from '../lib/dealStatusVocabulary'

type SaveDealStatusVocabularyInput = z.infer<typeof saveDealStatusVocabularySchema>
type VocabularySnapshot = { tenantId: string; value: unknown; updatedAt: string | null }
type VocabularyResult = Awaited<ReturnType<typeof resolveDealStatusVocabulary>>
const VOCABULARY_LOCK_SQL = 'select pg_advisory_xact_lock(hashtext(?), hashtext(?))'

function createTransactionalContainer(ctx: CommandRuntimeContext, em: EntityManager): AppContainer {
  const container = ctx.container.createScope() as AppContainer
  container.register({ em: asValue(em), cache: asValue(null) })
  container.register({ moduleConfigService: asValue(createModuleConfigService(container)) })
  return container
}

async function withVocabularyWrite<TResult>(
  ctx: CommandRuntimeContext,
  tenantId: string,
  write: (container: AppContainer, em: EntityManager) => Promise<TResult>,
): Promise<TResult> {
  const em = (ctx.container.resolve('em') as EntityManager).fork({ clear: true, useContext: false })
  const result = await em.transactional(async (transactionEm) => {
    await transactionEm.getConnection().execute(
      VOCABULARY_LOCK_SQL,
      [tenantId, `customers.${DEAL_STATUS_VOCABULARY_CONFIG_KEY}`],
      'all',
      transactionEm.getTransactionContext(),
    )
    return write(createTransactionalContainer(ctx, transactionEm), transactionEm)
  }, { clear: true })
  const service = ctx.container.resolve('moduleConfigService') as ModuleConfigService
  await service.invalidate('customers', DEAL_STATUS_VOCABULARY_CONFIG_KEY, { tenantId })
  const cache = resolveCrudCache(ctx.container)
  if (cache) {
    const segment = deriveCrudSegmentTag('customers.deal', new Request('http://localhost/api/customers/deals'))
    await runWithCacheTenant(tenantId, () => cache.deleteByTags([`crud:segment:${segment}`]))
    await invalidateCrudCache(ctx.container, DEAL_STATUS_VOCABULARY_RESOURCE_KIND, { tenantId }, tenantId, 'deal-status-vocabulary.changed')
  }
  return result
}

async function loadTenantSnapshot(ctx: CommandRuntimeContext, tenantId: string): Promise<VocabularySnapshot> {
  const container = ctx.transactionalEm ? createTransactionalContainer(ctx, ctx.transactionalEm) : ctx.container
  const service = container.resolve('moduleConfigService') as ModuleConfigService
  if (!ctx.transactionalEm) await service.invalidate('customers', DEAL_STATUS_VOCABULARY_CONFIG_KEY, { tenantId })
  const record = await service.getRecord('customers', DEAL_STATUS_VOCABULARY_CONFIG_KEY, { tenantId })
  const tenantRecord = record?.source === 'tenant' && record.tenantId === tenantId ? record : null
  return { tenantId, value: tenantRecord?.value ?? null, updatedAt: tenantRecord?.updatedAt ?? null }
}

export const saveDealStatusVocabularyCommand: CommandHandler<SaveDealStatusVocabularyInput, VocabularyResult> = {
  id: 'customers.settings.save_deal_status_vocabulary',
  isUndoable: true,
  prepareSnapshotInsideTransaction: true,
  async prepare(_input, ctx) {
    const tenantId = await requireTenantDealStatusManageAccess(ctx)
    return { before: await loadTenantSnapshot(ctx, tenantId) }
  },
  async execute(rawInput, ctx) {
    const tenantId = await requireTenantDealStatusManageAccess(ctx)
    const input = saveDealStatusVocabularySchema.parse(rawInput)
    return withVocabularyWrite(ctx, tenantId, async (container, transactionEm) => {
      await ctx.beforeTransactionalWrite?.(transactionEm, input)
      const service = container.resolve('moduleConfigService') as ModuleConfigService
      const current = await service.getRecord('customers', DEAL_STATUS_VOCABULARY_CONFIG_KEY, { tenantId })
      await enforceCommandOptimisticLockWithGuards(ctx.container, {
        resourceKind: DEAL_STATUS_VOCABULARY_RESOURCE_KIND,
        resourceId: tenantId,
        current: current?.source === 'tenant' && current.tenantId === tenantId ? current.updatedAt : null,
        request: ctx.request ?? null,
      })
      await enforceDealStatusReclassification({
        em: transactionEm, container, tenantId, userId: ctx.auth!.sub,
        updatedAt: current?.source === 'tenant' && current.tenantId === tenantId ? current.updatedAt : null,
        candidate: input.vocabulary, confirmation: input.reclassificationConfirmation, request: ctx.request,
      })
      await service.setValue('customers', DEAL_STATUS_VOCABULARY_CONFIG_KEY, input.vocabulary, { tenantId })
      return resolveDealStatusVocabulary(container, tenantId)
    })
  },
  captureAfter(rawInput, result, ctx) {
    const input = saveDealStatusVocabularySchema.parse(rawInput)
    return { tenantId: ctx.auth?.tenantId, value: input.vocabulary, updatedAt: result.updatedAt }
  },
  async buildLog({ snapshots }) {
    const before = snapshots.before as VocabularySnapshot | undefined
    const after = snapshots.after as VocabularySnapshot | undefined
    if (!before || !after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('customers.settings.dealStatusVocabulary.auditSave', 'Update deal status vocabulary'),
      resourceKind: DEAL_STATUS_VOCABULARY_RESOURCE_KIND,
      resourceId: after.tenantId,
      tenantId: after.tenantId,
      organizationId: null,
      snapshotBefore: before,
      snapshotAfter: after,
      payload: { undo: { before, after } satisfies UndoPayload<VocabularySnapshot> },
    }
  },
  async authorizeReplay({ ctx, logEntry }) {
    const tenantId = await requireTenantDealStatusManageAccess(ctx)
    const snapshot = extractUndoPayload<UndoPayload<VocabularySnapshot>>(logEntry)
    if ((snapshot?.before?.tenantId ?? snapshot?.after?.tenantId) !== tenantId) {
      const { translate } = await resolveTranslations()
      throw new CrudHttpError(403, { error: translate('customers.errors.access_denied', 'Access denied') })
    }
  },
  async undo({ ctx, logEntry }) {
    const tenantId = await requireTenantDealStatusManageAccess(ctx)
    const payload = extractUndoPayload<UndoPayload<VocabularySnapshot>>(logEntry)
    const before = payload?.before
    if (!before) return
    if (before.tenantId !== tenantId) {
      const { translate } = await resolveTranslations()
      throw new CrudHttpError(403, { error: translate('customers.errors.access_denied', 'Access denied') })
    }
    const expected = payload?.after?.updatedAt
    if (!expected) throw new Error('[internal] Missing deal status vocabulary undo version')
    await withVocabularyWrite(ctx, tenantId, async (container, transactionEm) => {
      const service = container.resolve('moduleConfigService') as ModuleConfigService
      const current = await service.getRecord('customers', DEAL_STATUS_VOCABULARY_CONFIG_KEY, { tenantId })
      const tenantRecord = current?.source === 'tenant' && current.tenantId === tenantId ? current : null
      if (!tenantRecord) {
        enforceRecordGoneIsConflict({ resourceKind: DEAL_STATUS_VOCABULARY_RESOURCE_KIND, resourceId: tenantId, expected })
      }
      await enforceCommandOptimisticLockWithGuards(ctx.container, {
        resourceKind: DEAL_STATUS_VOCABULARY_RESOURCE_KIND,
        resourceId: tenantId,
        current: tenantRecord?.updatedAt,
        expected,
        request: ctx.request ?? null,
      })
      await enforceDealStatusReclassification({
        em: transactionEm, container, tenantId, userId: ctx.auth!.sub,
        updatedAt: tenantRecord?.updatedAt ?? null, candidate: before.value, request: ctx.request,
      })
      await service.setValue('customers', DEAL_STATUS_VOCABULARY_CONFIG_KEY, before.value, { tenantId })
    })
  },
}

registerCommand(saveDealStatusVocabularyCommand)
