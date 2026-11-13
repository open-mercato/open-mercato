import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { DocumentWatcher } from '../data/entities'
import { DOCUMENTS_MAX_ACTIVE_WATCHERS } from '../lib/watchers'
import { lockDocumentAggregateRoot } from './aggregate'
import {
  assertCommandFeature,
  assertDocumentCommandCapability,
  resolveDocumentsCommandActor,
  resolveDocumentsCommandEntityManager,
  resolveDocumentsCommandFeatures,
  resolveDocumentsCommandScope,
} from './shared'

const watchCommandSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  documentId: z.string().uuid(),
  watcherId: z.string().uuid(),
  actorUserId: z.string().uuid(),
})

export type WatchCommandInput = z.infer<typeof watchCommandSchema>

export type WatchCommandResult = {
  id: string
  active: boolean
  changed: boolean
}

function assertHumanActor(
  input: WatchCommandInput,
  ctx: Parameters<CommandHandler['execute']>[1],
): void {
  const auth = ctx.auth
  if (!auth || auth.isApiKey === true || auth.sub.startsWith('api_key:')) {
    throw new CrudHttpError(403, { error: 'Forbidden' })
  }
  if (resolveDocumentsCommandActor(ctx) !== input.actorUserId) {
    throw new CrudHttpError(403, { error: 'Forbidden' })
  }
}

async function loadWatcher(
  em: EntityManager,
  input: WatchCommandInput,
): Promise<DocumentWatcher | null> {
  return findOneWithDecryption(
    em,
    DocumentWatcher,
    {
      documentId: input.documentId,
      userId: input.actorUserId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    },
    {
      filters: false,
      lockMode: LockMode.PESSIMISTIC_WRITE,
      orderBy: { createdAt: 'DESC', id: 'ASC' },
    },
    { tenantId: input.tenantId, organizationId: input.organizationId },
  )
}

async function countActiveWatchers(em: EntityManager, input: WatchCommandInput): Promise<number> {
  const watchers = await findWithDecryption(
    em,
    DocumentWatcher,
    {
      documentId: input.documentId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      deletedAt: null,
    },
    { fields: ['id'], limit: DOCUMENTS_MAX_ACTIVE_WATCHERS },
    { tenantId: input.tenantId, organizationId: input.organizationId },
  )
  return watchers.length
}

export const createWatchCommand: CommandHandler<WatchCommandInput, WatchCommandResult> = {
  id: 'documents.watch.create',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = watchCommandSchema.parse(rawInput)
    const scope = resolveDocumentsCommandScope(ctx, input)
    const em = resolveDocumentsCommandEntityManager(ctx)
    let watcher: DocumentWatcher | null = null
    let changed = false
    await withAtomicFlush(em, [async () => {
      await lockDocumentAggregateRoot(em, input.documentId, scope)
      assertHumanActor(input, ctx)
      await assertDocumentCommandCapability(ctx, em, input.documentId, scope, 'canView')
      watcher = await loadWatcher(em, input)
      if (watcher && !watcher.deletedAt) return
      if (await countActiveWatchers(em, input) >= DOCUMENTS_MAX_ACTIVE_WATCHERS) {
        throw new CrudHttpError(422, { error: 'documents.errors.watcherLimitReached' })
      }
      if (watcher) {
        watcher.deletedAt = null
      } else {
        watcher = em.create(DocumentWatcher, {
          id: input.watcherId,
          documentId: input.documentId,
          userId: input.actorUserId,
          tenantId: input.tenantId,
          organizationId: input.organizationId,
        })
        em.persist(watcher)
      }
      changed = true
    }], { transaction: true, label: 'documents.watch.create' })
    const finalWatcher = watcher as DocumentWatcher | null
    if (!finalWatcher) throw new Error('[internal] watcher create produced no row')
    return { id: finalWatcher.id, active: true, changed }
  },
  async buildLog({ input, result }) {
    if (!result.changed) return { skipLog: true }
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('documents.audit.watchCreated', 'Document watch enabled'),
      resourceKind: 'documents:document_watcher',
      resourceId: result.id,
      parentResourceKind: 'documents:document',
      parentResourceId: input.documentId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      snapshotBefore: { active: false },
      snapshotAfter: { active: true },
    }
  },
}

export const deleteWatchCommand: CommandHandler<WatchCommandInput, WatchCommandResult> = {
  id: 'documents.watch.delete',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = watchCommandSchema.parse(rawInput)
    const scope = resolveDocumentsCommandScope(ctx, input)
    const em = resolveDocumentsCommandEntityManager(ctx)
    let watcher: DocumentWatcher | null = null
    let changed = false
    await withAtomicFlush(em, [async () => {
      await lockDocumentAggregateRoot(em, input.documentId, scope)
      assertHumanActor(input, ctx)
      const features = await resolveDocumentsCommandFeatures(ctx, scope)
      assertCommandFeature(features, 'documents.view')
      watcher = await loadWatcher(em, input)
      if (!watcher || watcher.deletedAt) return
      watcher.deletedAt = new Date()
      changed = true
    }], { transaction: true, label: 'documents.watch.delete' })
    const finalWatcher = watcher as DocumentWatcher | null
    return { id: finalWatcher?.id ?? input.watcherId, active: false, changed }
  },
  async buildLog({ input, result }) {
    if (!result.changed) return { skipLog: true }
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('documents.audit.watchDeleted', 'Document watch disabled'),
      resourceKind: 'documents:document_watcher',
      resourceId: result.id,
      parentResourceKind: 'documents:document',
      parentResourceId: input.documentId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      snapshotBefore: { active: true },
      snapshotAfter: { active: false },
    }
  },
}

registerCommand(createWatchCommand)
registerCommand(deleteWatchCommand)
