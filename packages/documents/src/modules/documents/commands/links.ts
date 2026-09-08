import type { EntityManager } from '@mikro-orm/postgresql'
import { LockMode } from '@mikro-orm/core'
import { z } from 'zod'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  assertOptimisticLock,
  buildOptimisticLockConflictBody,
  enforceCommandOptimisticLockWithGuards,
} from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { DocumentEntityLink } from '../data/entities'
import { documentEntityLinkCreateSchema } from '../data/validators'
import { DOCUMENTS_ENTITY_IDS } from '../lib/constants'
import {
  assertDocumentEntityLinkCapacity,
  buildDocumentEntityLinkTargetWhere,
  createDocumentEntityLinkData,
  getDocumentEntityLinkEntityId,
  getDocumentEntityLinkType,
} from '../lib/entityLinks'
import { getEntityRegistryEntry } from '../lib/entityRegistry'
import { isDocumentEntityRegistryModuleEnabled } from '../lib/entityRegistryAvailability.server'
import {
  verifyEntityRegistrySelection,
  type VerifiedEntityRegistrySelection,
} from '../lib/entityRegistry.server'
import { lockDocumentAggregateRoot } from './aggregate'
import { bufferLinkMutationSideEffects } from './side-effects'
import {
  assertCommandFeature,
  assertDocumentCommandCanEdit,
  resolveDocumentsCommandActor,
  resolveDocumentsCommandEntityManager,
  resolveDocumentsCommandFeatures,
  resolveDocumentsCommandScope,
} from './shared'
import { nextDocumentVersion } from './mutation-helpers'

const scopedSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
})

export const linkCreateCommandSchema = scopedSchema.extend({
  linkId: z.string().uuid(),
  documentId: z.string().uuid(),
  link: documentEntityLinkCreateSchema,
})

export const linkDeleteCommandSchema = scopedSchema.extend({
  documentId: z.string().uuid(),
  linkId: z.string().uuid(),
})

export type LinkCreateCommandInput = z.infer<typeof linkCreateCommandSchema>
export type LinkDeleteCommandInput = z.infer<typeof linkDeleteCommandSchema>

type LinkStateSnapshot = {
  id: string
  existed: boolean
  deletedAt: string | null
  updatedAt: string | null
}

type LinkUndoPayload = {
  before?: LinkStateSnapshot | null
  after?: LinkStateSnapshot | null
  createdByCommand?: boolean
}

export type LinkCreateCommandResult = {
  id: string
  created: boolean
  updatedAt: string
  before: LinkStateSnapshot
  after: LinkStateSnapshot
}

export type LinkDeleteCommandResult = {
  id: string
  updatedAt: string
  before: LinkStateSnapshot
  after: LinkStateSnapshot
}

function buildCanonicalLinkInput(
  input: LinkCreateCommandInput,
  verified: VerifiedEntityRegistrySelection,
): LinkCreateCommandInput {
  return {
    ...input,
    link: {
      ...input.link,
      label: verified.label,
      href: verified.href,
    },
  }
}

function assertVerifiedLinkTargetMatchesRow(
  verified: VerifiedEntityRegistrySelection,
  link: DocumentEntityLink,
): void {
  if (verified.id !== getDocumentEntityLinkEntityId(link)) {
    throw new CrudHttpError(409, { error: 'Record changed by another user' })
  }
}

function captureLinkState(link: DocumentEntityLink | null, fallbackId: string): LinkStateSnapshot {
  return {
    id: link?.id ?? fallbackId,
    existed: link !== null,
    deletedAt: link?.deletedAt?.toISOString() ?? null,
    updatedAt: link?.updatedAt?.toISOString() ?? null,
  }
}

function assertLinkStateUnchanged(link: DocumentEntityLink, expected: LinkStateSnapshot): void {
  if (!expected.updatedAt) throw new CrudHttpError(409, { error: 'Record changed by another user' })
  assertOptimisticLock({
    resourceKind: DOCUMENTS_ENTITY_IDS.documentEntityLink,
    resourceId: link.id,
    current: link.updatedAt,
    expected: expected.updatedAt,
    envValue: 'all',
  })
  const deletedAt = link.deletedAt?.toISOString() ?? null
  if (deletedAt !== expected.deletedAt) {
    throw new CrudHttpError(409, buildOptimisticLockConflictBody(
      link.updatedAt.toISOString(),
      expected.updatedAt,
    ))
  }
}

async function authorizeLinkCreateUndo(
  ctx: Parameters<NonNullable<CommandHandler['undo']>>[0]['ctx'],
  em: EntityManager,
  input: LinkDeleteCommandInput,
  entityType: Parameters<typeof getEntityRegistryEntry>[0],
): Promise<void> {
  const scope = resolveDocumentsCommandScope(ctx, input)
  const features = await assertDocumentCommandCanEdit(ctx, em, input.documentId, scope)
  const registryEntry = getEntityRegistryEntry(entityType)
  if (!registryEntry) throw new CrudHttpError(400, { error: 'documents.links.invalidEntityType' })
  if (!isDocumentEntityRegistryModuleEnabled(registryEntry)) {
    throw new CrudHttpError(403, { error: 'documents.links.targetRestricted' })
  }
  assertCommandFeature(features, registryEntry.requiredFeature)
}

async function loadLinkById(
  em: EntityManager,
  input: LinkDeleteCommandInput,
  includeDeleted = false,
  lock = false,
): Promise<DocumentEntityLink | null> {
  return findOneWithDecryption(
    em,
    DocumentEntityLink,
    {
      id: input.linkId,
      documentId: input.documentId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      ...(includeDeleted ? {} : { deletedAt: null }),
    },
    {
      ...(includeDeleted ? { filters: false } : {}),
      ...(lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : {}),
    },
    { tenantId: input.tenantId, organizationId: input.organizationId },
  )
}

async function loadLinkByTarget(
  em: EntityManager,
  input: LinkCreateCommandInput,
  lock = false,
): Promise<DocumentEntityLink | null> {
  return findOneWithDecryption(
    em,
    DocumentEntityLink,
    {
      documentId: input.documentId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      ...buildDocumentEntityLinkTargetWhere(input.link.entityType, input.link.entityId),
    },
    {
      filters: false,
      orderBy: { updatedAt: 'DESC' },
      ...(lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : {}),
    },
    { tenantId: input.tenantId, organizationId: input.organizationId },
  )
}

const createLinkCommand: CommandHandler<LinkCreateCommandInput, LinkCreateCommandResult> = {
  id: 'documents.link.create',
  async execute(rawInput, ctx) {
    const input = linkCreateCommandSchema.parse(rawInput)
    const scope = resolveDocumentsCommandScope(ctx, input)
    const registryEntry = getEntityRegistryEntry(input.link.entityType)
    if (!registryEntry) {
      throw new CrudHttpError(400, { error: 'documents.links.invalidEntityType' })
    }
    if (!isDocumentEntityRegistryModuleEnabled(registryEntry)) {
      throw new CrudHttpError(403, { error: 'documents.links.targetRestricted' })
    }
    const preflightFeatures = await resolveDocumentsCommandFeatures(ctx, scope)
    assertCommandFeature(preflightFeatures, registryEntry.requiredFeature)
    const request = ctx.request
    if (!request) {
      throw new CrudHttpError(503, { error: 'documents.links.targetUnavailable' })
    }
    // The registry lookup is a loopback HTTP request; it must complete before
    // the aggregate transaction so it never pins the PESSIMISTIC_WRITE lock or
    // a second pool connection. Freshness at commit is preserved by the
    // in-transaction re-checks below (fresh ACL, module availability, feature).
    const verified = await verifyEntityRegistrySelection(request, input.link)
    const canonicalInput = buildCanonicalLinkInput(input, verified)
    const writeEm = resolveDocumentsCommandEntityManager(ctx)
    let link: DocumentEntityLink | null = null
    let created = false
    let before!: LinkStateSnapshot
    let after!: LinkStateSnapshot
    await withAtomicFlush(writeEm, [
      async () => {
        await lockDocumentAggregateRoot(writeEm, input.documentId, scope)
        const features = await assertDocumentCommandCanEdit(ctx, writeEm, input.documentId, scope)
        if (!isDocumentEntityRegistryModuleEnabled(registryEntry)) {
          throw new CrudHttpError(403, { error: 'documents.links.targetRestricted' })
        }
        assertCommandFeature(features, registryEntry.requiredFeature)
        const existing = await loadLinkByTarget(writeEm, canonicalInput, true)
        before = captureLinkState(existing, input.linkId)
        if (existing && !existing.deletedAt) {
          link = existing
          return
        }
        await assertDocumentEntityLinkCapacity(writeEm, input.documentId, scope)
        link = existing ?? writeEm.create(
          DocumentEntityLink,
          createDocumentEntityLinkData({
            id: input.linkId,
            documentId: input.documentId,
            scope,
            actorUserId: resolveDocumentsCommandActor(ctx),
            link: canonicalInput.link,
          }),
        )
        if (!existing) writeEm.persist(link)
        link.labelSnapshot = canonicalInput.link.label
        link.hrefSnapshot = canonicalInput.link.href
        link.source = canonicalInput.link.source
        link.createdByUserId = resolveDocumentsCommandActor(ctx)
        link.deletedAt = null
        link.updatedAt = nextDocumentVersion(link.updatedAt)
        created = true
      },
      () => {
        const captured = link as DocumentEntityLink | null
        if (!captured) throw new Error('[internal] document link create produced no row')
        after = captureLinkState(captured, captured.id)
      },
    ], { transaction: true, label: 'documents.link.create' })
    const finalLink = link as DocumentEntityLink | null
    if (!finalLink) throw new Error('[internal] document link create produced no row')

    if (!created) {
      return {
        id: finalLink.id,
        created: false,
        updatedAt: finalLink.updatedAt.toISOString(),
        before,
        after,
      }
    }

    await bufferLinkMutationSideEffects(ctx, 'created', finalLink, {
      entityType: input.link.entityType,
      entityId: input.link.entityId,
    })
    return {
      id: finalLink.id,
      created: true,
      updatedAt: finalLink.updatedAt.toISOString(),
      before,
      after,
    }
  },
  async buildLog({ input, result }) {
    if (!result.created) return { skipLog: true }
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('documents.audit.linkCreated', 'Link document to record'),
      resourceKind: DOCUMENTS_ENTITY_IDS.documentEntityLink,
      resourceId: result.id,
      parentResourceKind: DOCUMENTS_ENTITY_IDS.document,
      parentResourceId: input.documentId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      snapshotBefore: result.before,
      snapshotAfter: result.after,
      payload: {
        undo: {
          before: result.before,
          after: result.after,
          createdByCommand: result.created,
        } satisfies LinkUndoPayload,
      },
    }
  },
  async undo({ logEntry, ctx }) {
    const undo = extractUndoPayload<LinkUndoPayload>(logEntry)
    if (!undo?.createdByCommand) return
    const before = undo?.before
    const after = undo?.after
    if (!after || (before?.existed && before.deletedAt === null)) return
    const input = linkCreateCommandSchema.parse(
      logEntry.commandPayload && typeof logEntry.commandPayload === 'object'
        ? (logEntry.commandPayload as { __redoInput?: unknown }).__redoInput
        : {},
    )
    const em = resolveDocumentsCommandEntityManager(ctx)
    let link: DocumentEntityLink | null = null
    await withAtomicFlush(em, [async () => {
      await lockDocumentAggregateRoot(em, input.documentId, {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      })
      await authorizeLinkCreateUndo(ctx, em, input, input.link.entityType)
      link = await loadLinkById(em, { ...input, linkId: after.id }, true, true)
      if (!link) throw new CrudHttpError(409, { error: 'Record changed by another user' })
      assertLinkStateUnchanged(link, after)
      const version = nextDocumentVersion(link.updatedAt)
      link.deletedAt = before?.deletedAt ? new Date(before.deletedAt) : version
      link.updatedAt = version
    }], { transaction: true, label: 'documents.link.create.undo' })
    if (link) await bufferLinkMutationSideEffects(ctx, 'deleted', link, { undo: true })
  },
}

const deleteLinkCommand: CommandHandler<LinkDeleteCommandInput, LinkDeleteCommandResult> = {
  id: 'documents.link.delete',
  async execute(rawInput, ctx) {
    const input = linkDeleteCommandSchema.parse(rawInput)
    const scope = resolveDocumentsCommandScope(ctx, input)
    const em = resolveDocumentsCommandEntityManager(ctx)
    let link: DocumentEntityLink | null = null
    let before!: LinkStateSnapshot
    let after!: LinkStateSnapshot
    await withAtomicFlush(em, [
      async () => {
        await lockDocumentAggregateRoot(em, input.documentId, scope)
        await assertDocumentCommandCanEdit(ctx, em, input.documentId, scope)
        link = await loadLinkById(em, input, false, true)
        if (!link) throw new CrudHttpError(404, { error: 'documents.links.notFound' })
        before = captureLinkState(link, input.linkId)
        await enforceCommandOptimisticLockWithGuards(ctx.container, {
          resourceKind: DOCUMENTS_ENTITY_IDS.documentEntityLink,
          resourceId: link.id,
          current: link.updatedAt,
          request: ctx.request ?? null,
        })
        const version = nextDocumentVersion(link.updatedAt)
        link.deletedAt = version
        link.updatedAt = version
      },
      () => {
        const captured = link as DocumentEntityLink | null
        if (!captured) throw new Error('[internal] document link delete produced no row')
        after = captureLinkState(captured, captured.id)
      },
    ], { transaction: true, label: 'documents.link.delete' })
    const deletedLink = link as DocumentEntityLink | null
    if (!deletedLink) throw new Error('[internal] document link delete produced no row')
    await bufferLinkMutationSideEffects(ctx, 'deleted', deletedLink)
    return {
      id: deletedLink.id,
      updatedAt: deletedLink.updatedAt.toISOString(),
      before,
      after,
    }
  },
  async buildLog({ input, result }) {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('documents.audit.linkDeleted', 'Unlink document from record'),
      resourceKind: DOCUMENTS_ENTITY_IDS.documentEntityLink,
      resourceId: result.id,
      parentResourceKind: DOCUMENTS_ENTITY_IDS.document,
      parentResourceId: input.documentId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      snapshotBefore: result.before,
      snapshotAfter: result.after,
      payload: {
        undo: {
          before: result.before,
          after: result.after,
        } satisfies LinkUndoPayload,
      },
    }
  },
  async undo({ logEntry, ctx }) {
    const undo = extractUndoPayload<LinkUndoPayload>(logEntry)
    const before = undo?.before
    const after = undo?.after
    if (!before?.existed || before.deletedAt !== null) return
    const input = linkDeleteCommandSchema.parse(
      logEntry.commandPayload && typeof logEntry.commandPayload === 'object'
        ? (logEntry.commandPayload as { __redoInput?: unknown }).__redoInput
        : {},
    )
    const em = resolveDocumentsCommandEntityManager(ctx)
    if (!after) throw new CrudHttpError(409, { error: 'Record changed by another user' })
    // Re-verify the resurrected target over HTTP before the aggregate
    // transaction so the loopback request never runs under the
    // PESSIMISTIC_WRITE lock. The locked revalidation below pins the row to
    // the undo snapshot (monotonic versions), so the state verified here is
    // exactly the state that gets resurrected.
    const preflightLink = await loadLinkById(
      (ctx.container.resolve('em') as EntityManager).fork(),
      input,
      true,
    )
    if (!preflightLink) throw new CrudHttpError(409, { error: 'Record changed by another user' })
    const preflightRegistryEntry = getEntityRegistryEntry(getDocumentEntityLinkType(preflightLink))
    if (!preflightRegistryEntry) {
      throw new CrudHttpError(400, { error: 'documents.links.invalidEntityType' })
    }
    if (!isDocumentEntityRegistryModuleEnabled(preflightRegistryEntry)) {
      throw new CrudHttpError(403, { error: 'documents.links.targetRestricted' })
    }
    if (!ctx.request) {
      throw new CrudHttpError(503, { error: 'documents.links.targetUnavailable' })
    }
    const verified = await verifyEntityRegistrySelection(ctx.request, {
      entityType: preflightRegistryEntry.type,
      entityId: getDocumentEntityLinkEntityId(preflightLink),
      label: preflightLink.labelSnapshot,
      href: preflightLink.hrefSnapshot,
    })
    let link: DocumentEntityLink | null = null
    await withAtomicFlush(em, [async () => {
      await lockDocumentAggregateRoot(em, input.documentId, {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      })
      const features = await assertDocumentCommandCanEdit(ctx, em, input.documentId, {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      })
      link = await loadLinkById(em, input, true, true)
      if (!link) throw new CrudHttpError(409, { error: 'Record changed by another user' })
      assertLinkStateUnchanged(link, after)
      const registryEntry = getEntityRegistryEntry(getDocumentEntityLinkType(link))
      if (!registryEntry) throw new CrudHttpError(400, { error: 'documents.links.invalidEntityType' })
      if (!isDocumentEntityRegistryModuleEnabled(registryEntry)) {
        throw new CrudHttpError(403, { error: 'documents.links.targetRestricted' })
      }
      assertCommandFeature(features, registryEntry.requiredFeature)
      assertVerifiedLinkTargetMatchesRow(verified, link)
      await assertDocumentEntityLinkCapacity(em, input.documentId, {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      })
      link.labelSnapshot = verified.label
      link.hrefSnapshot = verified.href
      link.deletedAt = null
      link.updatedAt = nextDocumentVersion(link.updatedAt)
    }], { transaction: true, label: 'documents.link.delete.undo' })
    if (link) await bufferLinkMutationSideEffects(ctx, 'created', link, { undo: true })
  },
}

registerCommand(createLinkCommand)
registerCommand(deleteLinkCommand)

export { createLinkCommand, deleteLinkCommand }
