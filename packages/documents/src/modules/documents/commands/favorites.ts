import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { DocumentFavorite } from '../data/entities'
import { lockDocumentAggregateRoot } from './aggregate'
import {
  assertDocumentCommandCapability,
  resolveDocumentsCommandActor,
  resolveDocumentsCommandEntityManager,
  resolveDocumentsCommandScope,
} from './shared'

const favoriteCommandSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  documentId: z.string().uuid(),
  favoriteId: z.string().uuid(),
  actorUserId: z.string().uuid(),
})

export type FavoriteCommandInput = z.infer<typeof favoriteCommandSchema>

export type FavoriteCommandResult = {
  id: string
  active: boolean
  changed: boolean
}

function assertHumanActor(
  input: FavoriteCommandInput,
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

async function loadFavorite(
  em: EntityManager,
  input: FavoriteCommandInput,
): Promise<DocumentFavorite | null> {
  return findOneWithDecryption(
    em,
    DocumentFavorite,
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

async function authorizeFavorite(
  ctx: Parameters<CommandHandler['execute']>[1],
  em: EntityManager,
  input: FavoriteCommandInput,
): Promise<void> {
  assertHumanActor(input, ctx)
  await assertDocumentCommandCapability(
    ctx,
    em,
    input.documentId,
    resolveDocumentsCommandScope(ctx, input),
    'canView',
  )
}

export const createFavoriteCommand: CommandHandler<FavoriteCommandInput, FavoriteCommandResult> = {
  id: 'documents.favorite.create',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = favoriteCommandSchema.parse(rawInput)
    const scope = resolveDocumentsCommandScope(ctx, input)
    const em = resolveDocumentsCommandEntityManager(ctx)
    let favorite: DocumentFavorite | null = null
    let changed = false
    await withAtomicFlush(em, [async () => {
      await lockDocumentAggregateRoot(em, input.documentId, scope)
      await authorizeFavorite(ctx, em, input)
      favorite = await loadFavorite(em, input)
      if (favorite && !favorite.deletedAt) return
      if (favorite) {
        favorite.deletedAt = null
      } else {
        favorite = em.create(DocumentFavorite, {
          id: input.favoriteId,
          documentId: input.documentId,
          userId: input.actorUserId,
          tenantId: input.tenantId,
          organizationId: input.organizationId,
        })
        em.persist(favorite)
      }
      changed = true
    }], { transaction: true, label: 'documents.favorite.create' })
    const finalFavorite = favorite as DocumentFavorite | null
    if (!finalFavorite) throw new Error('[internal] favorite create produced no row')
    return { id: finalFavorite.id, active: true, changed }
  },
  async buildLog({ input, result }) {
    if (!result.changed) return { skipLog: true }
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('documents.audit.favoriteCreated', 'Document added to favorites'),
      resourceKind: 'documents:document_favorite',
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

export const deleteFavoriteCommand: CommandHandler<FavoriteCommandInput, FavoriteCommandResult> = {
  id: 'documents.favorite.delete',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = favoriteCommandSchema.parse(rawInput)
    const scope = resolveDocumentsCommandScope(ctx, input)
    const em = resolveDocumentsCommandEntityManager(ctx)
    let favorite: DocumentFavorite | null = null
    let changed = false
    await withAtomicFlush(em, [async () => {
      await lockDocumentAggregateRoot(em, input.documentId, scope)
      await authorizeFavorite(ctx, em, input)
      favorite = await loadFavorite(em, input)
      if (!favorite || favorite.deletedAt) return
      favorite.deletedAt = new Date()
      changed = true
    }], { transaction: true, label: 'documents.favorite.delete' })
    const finalFavorite = favorite as DocumentFavorite | null
    return { id: finalFavorite?.id ?? input.favoriteId, active: false, changed }
  },
  async buildLog({ input, result }) {
    if (!result.changed) return { skipLog: true }
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('documents.audit.favoriteDeleted', 'Document removed from favorites'),
      resourceKind: 'documents:document_favorite',
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

registerCommand(createFavoriteCommand)
registerCommand(deleteFavoriteCommand)
