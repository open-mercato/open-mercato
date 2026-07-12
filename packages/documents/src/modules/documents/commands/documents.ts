import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  assertOptimisticLock,
  buildOptimisticLockConflictBody,
} from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  Document,
  DocumentContent,
  DocumentEntityLink,
  DocumentFolder,
  DocumentTemplate,
} from '../data/entities'
import { documentTemplateInstantiateSchema } from '../data/validators'
import { DOCUMENTS_ENTITY_IDS } from '../lib/constants'
import {
  advanceDocumentCollaborationGeneration,
  mutateDocumentContentState,
} from '../lib/contentService'
import {
  buildDocumentEntityLinkTarget,
  createDocumentEntityLinkData,
} from '../lib/entityLinks'
import { getEntityRegistryEntry } from '../lib/entityRegistry'
import { isDocumentEntityRegistryModuleEnabled } from '../lib/entityRegistryAvailability.server'
import { dedupeTemplateLinkSlots, prepareTemplateRender } from '../lib/templateInstantiation'
import { assertNoPostCreateDocumentDependents } from './aggregate'
import {
  bufferDocumentMutationSideEffects,
  bufferLinkMutationSideEffects,
} from './side-effects'
import {
  assertCommandFeature,
  assertDocumentCommandCanEdit,
  resolveDocumentsCommandActor,
  resolveDocumentsCommandEntityManager,
  resolveDocumentsCommandFeatures,
  resolveDocumentsCommandScope,
} from './shared'
import { nextDocumentVersion } from './mutation-helpers'

export const instantiateDocumentCommandSchema = documentTemplateInstantiateSchema.extend({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  documentId: z.string().uuid(),
  contentId: z.string().uuid(),
  linkIds: z.array(z.string().uuid()).max(20),
  createdByUserId: z.string().uuid(),
}).superRefine((input, context) => {
  if (input.linkIds.length !== dedupeTemplateLinkSlots(input.slots).length) {
    context.addIssue({ code: 'custom', message: 'documents.templates.linkIdentityMismatch' })
  }
})

export type InstantiateDocumentCommandInput = z.infer<typeof instantiateDocumentCommandSchema>

type InstantiateSnapshot = {
  documentId: string
  contentId: string
  linkIds: string[]
  documentDeletedAt: string | null
  contentDeletedAt: string | null
  documentUpdatedAt: string | null
  contentUpdatedAt: string | null
  links: Array<{ id: string; deletedAt: string | null; updatedAt: string | null }>
}

type InstantiateUndoPayload = {
  before?: InstantiateSnapshot | null
  after?: InstantiateSnapshot | null
}

async function loadTemplate(
  em: EntityManager,
  input: InstantiateDocumentCommandInput,
): Promise<DocumentTemplate> {
  const template = await findOneWithDecryption(
    em,
    DocumentTemplate,
    {
      id: input.templateId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      deletedAt: null,
      isActive: true,
    },
    undefined,
    { tenantId: input.tenantId, organizationId: input.organizationId },
  )
  if (!template) throw new CrudHttpError(404, { error: 'documents.templates.notFound' })
  return template
}

async function lockAndValidateTemplateRevision(
  em: EntityManager,
  input: InstantiateDocumentCommandInput,
): Promise<DocumentTemplate> {
  const template = await findOneWithDecryption(
    em,
    DocumentTemplate,
    {
      id: input.templateId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      deletedAt: null,
      isActive: true,
    },
    { lockMode: LockMode.PESSIMISTIC_READ },
    { tenantId: input.tenantId, organizationId: input.organizationId },
  )
  const submittedRevision = new Date(input.templateUpdatedAt)
  if (
    !template
    || Number.isNaN(submittedRevision.getTime())
    || submittedRevision.toISOString() !== template.updatedAt.toISOString()
  ) {
    throw new CrudHttpError(409, { error: 'documents.templates.staleTemplate' })
  }
  return template
}

async function assertWritableFolder(
  em: EntityManager,
  input: InstantiateDocumentCommandInput,
  features: readonly string[],
  actorUserId: string,
  lock = false,
): Promise<void> {
  if (!input.folderId) return
  const folder = await findOneWithDecryption(
    em,
    DocumentFolder,
    {
      id: input.folderId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      deletedAt: null,
    },
    lock ? { lockMode: LockMode.PESSIMISTIC_READ } : undefined,
    { tenantId: input.tenantId, organizationId: input.organizationId },
  )
  if (!folder) throw new CrudHttpError(404, { error: 'documents.folders.notFound' })
  if (folder.ownerUserId !== actorUserId) assertCommandFeature(features, 'documents.manage')
}

async function loadAggregate(
  em: EntityManager,
  input: InstantiateDocumentCommandInput,
  lock = false,
  afterDocumentLock?: () => Promise<void>,
): Promise<{
  document: Document | null
  content: DocumentContent | null
  linksById: Map<string, DocumentEntityLink>
}> {
  const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
  const options = lock
    ? { filters: false, lockMode: LockMode.PESSIMISTIC_WRITE } as const
    : { filters: false } as const
  if (lock) {
    // Keep lock acquisition deterministic on the transaction's single
    // connection. This also aligns every undo with collab writes, which lock
    // DocumentContent after resolving the parent document.
    const document = await findOneWithDecryption(
      em,
      Document,
      { id: input.documentId, ...scope },
      options,
      scope,
    )
    if (afterDocumentLock) await afterDocumentLock()
    const content = await findOneWithDecryption(
      em,
      DocumentContent,
      { documentId: input.documentId, ...scope },
      options,
      scope,
    )
    // The instantiated document did not exist before this command, so every
    // link currently attached to it belongs to the aggregate. Loading only the
    // original linkIds would miss a link added after creation and let undo
    // delete the document while leaving that concurrent relation behind.
    const links = await findWithDecryption(
      em,
      DocumentEntityLink,
      { documentId: input.documentId, ...scope },
      options,
      scope,
    )
    return { document, content, linksById: new Map(links.map((link) => [link.id, link])) }
  }
  const [document, content, links] = await Promise.all([
    findOneWithDecryption(
      em,
      Document,
      { id: input.documentId, ...scope },
      options,
      scope,
    ),
    findOneWithDecryption(
      em,
      DocumentContent,
      { documentId: input.documentId, ...scope },
      options,
      scope,
    ),
    findWithDecryption(
      em,
      DocumentEntityLink,
      { documentId: input.documentId, ...scope },
      options,
      scope,
    ),
  ])
  return { document, content, linksById: new Map(links.map((link) => [link.id, link])) }
}

function snapshotAggregate(
  input: InstantiateDocumentCommandInput,
  aggregate: {
    document: Document | null
    content: DocumentContent | null
    linksById: Map<string, DocumentEntityLink>
  },
): InstantiateSnapshot {
  return {
    documentId: input.documentId,
    contentId: aggregate.content?.id ?? input.contentId,
    linkIds: [...input.linkIds],
    documentDeletedAt: aggregate.document?.deletedAt?.toISOString() ?? null,
    contentDeletedAt: aggregate.content?.deletedAt?.toISOString() ?? null,
    documentUpdatedAt: aggregate.document?.updatedAt?.toISOString() ?? null,
    contentUpdatedAt: aggregate.content?.updatedAt?.toISOString() ?? null,
    links: input.linkIds.map((id) => {
      const link = aggregate.linksById.get(id)
      return {
        id,
        deletedAt: link?.deletedAt?.toISOString() ?? null,
        updatedAt: link?.updatedAt?.toISOString() ?? null,
      }
    }),
  }
}

function assertInstantiateEntityUnchanged(
  entity: { updatedAt: Date; deletedAt?: Date | null } | null,
  expected: { updatedAt: string | null; deletedAt: string | null },
  resourceKind: string,
  resourceId: string,
): void {
  if (!entity || !expected.updatedAt) {
    throw new CrudHttpError(409, { error: 'Record changed by another user' })
  }
  assertOptimisticLock({
    resourceKind,
    resourceId,
    current: entity.updatedAt,
    expected: expected.updatedAt,
    envValue: 'all',
  })
  const deletedAt = entity.deletedAt?.toISOString() ?? null
  if (deletedAt !== expected.deletedAt) {
    throw new CrudHttpError(409, buildOptimisticLockConflictBody(
      entity.updatedAt.toISOString(),
      expected.updatedAt,
    ))
  }
}

function assertInstantiateSlotFeatures(
  slots: readonly Pick<InstantiateDocumentCommandInput['slots'][number], 'entityType'>[],
  features: readonly string[],
): void {
  for (const slot of slots) {
    const registryEntry = getEntityRegistryEntry(slot.entityType)
    if (!registryEntry) {
      throw new CrudHttpError(400, { error: 'documents.links.invalidEntityType' })
    }
    if (!isDocumentEntityRegistryModuleEnabled(registryEntry)) {
      throw new CrudHttpError(403, { error: 'Forbidden' })
    }
    assertCommandFeature(features, registryEntry.requiredFeature)
  }
}

type InstantiateDocumentCommandResult = {
  id: string
  updatedAt: string
  links: Array<{ id: string; entityType: string; label: string; href: string }>
  before: InstantiateSnapshot
  after: InstantiateSnapshot
}

const instantiateDocumentCommand: CommandHandler<
  InstantiateDocumentCommandInput,
  InstantiateDocumentCommandResult
> = {
  id: 'documents.document.instantiate',
  async execute(rawInput, ctx) {
    const input = instantiateDocumentCommandSchema.parse(rawInput)
    const scope = resolveDocumentsCommandScope(ctx, input)
    const requestEm = ctx.container.resolve('em') as EntityManager
    const actorUserId = resolveDocumentsCommandActor(ctx)
    if (actorUserId !== input.createdByUserId) {
      throw new CrudHttpError(403, { error: 'Forbidden' })
    }
    const previewFeatures = await resolveDocumentsCommandFeatures(ctx, scope)
    assertCommandFeature(previewFeatures, 'documents.create')
    assertCommandFeature(previewFeatures, 'documents.edit')
    await assertWritableFolder(requestEm, input, previewFeatures, actorUserId)
    const template = await loadTemplate(requestEm, input)
    const sourceRequest = ctx.request
    if (!sourceRequest) throw new Error('[internal] template instantiation requires the source request')
    // The authoritative render performs up to 20 loopback HTTP verifications,
    // so it must complete before the transaction acquires aggregate locks. It
    // enforces the preview-digest CAS against caller-controlled values, and
    // the in-transaction revalidation below pins its inputs at commit: the
    // locked template revision check rejects any template edited after this
    // render (monotonic versions), and slot features plus module availability
    // are re-asserted against a fresh post-lock ACL.
    const prepared = await prepareTemplateRender({
      request: sourceRequest,
      template,
      title: input.title,
      locale: input.locale,
      effectiveDate: input.effectiveDate,
      templateUpdatedAt: input.templateUpdatedAt,
      slots: input.slots,
      userFeatures: previewFeatures,
      expectedDigest: input.previewDigest,
      rejectUnresolved: true,
    })
    const uniqueLinkSlots = dedupeTemplateLinkSlots(prepared.verifiedSlots)
    const em = resolveDocumentsCommandEntityManager(ctx)
    let aggregate!: Awaited<ReturnType<typeof loadAggregate>>
    let document: Document | null = null
    let content: DocumentContent | null = null
    const links: DocumentEntityLink[] = []
    let before!: InstantiateSnapshot
    let after!: InstantiateSnapshot

    await withAtomicFlush(em, [
      async () => {
        await lockAndValidateTemplateRevision(em, input)
        aggregate = await loadAggregate(em, input, true)
        const features = await resolveDocumentsCommandFeatures(ctx, scope)
        assertCommandFeature(features, 'documents.create')
        assertCommandFeature(features, 'documents.edit')
        assertInstantiateSlotFeatures(uniqueLinkSlots, features)
        before = snapshotAggregate(input, aggregate)
        if (
          (aggregate.document && !aggregate.document.deletedAt)
          || (aggregate.content && !aggregate.content.deletedAt)
          || Array.from(aggregate.linksById.values()).some((link) => (
            !input.linkIds.includes(link.id) || !link.deletedAt
          ))
        ) {
          throw new CrudHttpError(409, { error: 'Record changed by another user' })
        }
        await assertWritableFolder(em, input, features, actorUserId, true)
        document = aggregate.document
        if (!document) {
          document = em.create(Document, {
            id: input.documentId,
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            title: input.title,
            folderId: input.folderId ?? null,
            ownerUserId: input.createdByUserId,
            createdByUserId: input.createdByUserId,
            isActive: true,
          })
          em.persist(document)
        } else {
          document.title = input.title
          document.folderId = input.folderId ?? null
          document.ownerUserId = input.createdByUserId
          document.createdByUserId = input.createdByUserId
          document.isActive = true
          document.deletedAt = null
          document.updatedAt = nextDocumentVersion(document.updatedAt)
        }
      },
      async () => {
        if (aggregate.content) {
          advanceDocumentCollaborationGeneration(aggregate.content)
        }
        content = await mutateDocumentContentState(
          em,
          input.documentId,
          scope,
          {
            yjsState: prepared.content.yjsState,
            contentHtml: prepared.content.html,
            contentText: prepared.content.text,
          },
          { id: input.contentId, existingContent: aggregate.content },
        )
        aggregate.content = content
      },
      () => {
        for (const [index, slot] of uniqueLinkSlots.entries()) {
          const linkId = input.linkIds[index]!
          let link = aggregate.linksById.get(linkId) ?? null
          if (!link) {
            link = em.create(DocumentEntityLink, createDocumentEntityLinkData({
              id: linkId,
              documentId: input.documentId,
              scope,
              actorUserId: input.createdByUserId,
              link: {
                entityType: slot.entityType,
                entityId: slot.entityId,
                label: slot.label,
                href: slot.href,
                source: 'template',
              },
            }))
            em.persist(link)
            aggregate.linksById.set(linkId, link)
          }
          Object.assign(link, buildDocumentEntityLinkTarget(slot.entityType, slot.entityId))
          link.labelSnapshot = slot.label
          link.hrefSnapshot = slot.href
          link.source = 'template'
          link.createdByUserId = input.createdByUserId
          link.deletedAt = null
          link.updatedAt = nextDocumentVersion(link.updatedAt)
          links.push(link)
        }
      },
      () => {
        if (!document || !content) {
          throw new Error('[internal] document instantiation did not produce an aggregate')
        }
        aggregate.document = document
        aggregate.content = content
        after = snapshotAggregate(input, aggregate)
      },
    ], { transaction: true, label: 'documents.document.instantiate' })

    const finalDocument = document as Document | null
    if (!finalDocument) throw new Error('[internal] document instantiation did not produce a document')
    await bufferDocumentMutationSideEffects(ctx, 'created', finalDocument)
    await Promise.all(links.map((link, index) => bufferLinkMutationSideEffects(
      ctx,
      'created',
      link,
      {
        entityType: uniqueLinkSlots[index]!.entityType,
        entityId: uniqueLinkSlots[index]!.entityId,
      },
    )))

    return {
      id: input.documentId,
      updatedAt: finalDocument.updatedAt.toISOString(),
      links: links.map((link, index) => ({
        id: link.id,
        entityType: uniqueLinkSlots[index]!.entityType,
        label: link.labelSnapshot,
        href: link.hrefSnapshot,
      })),
      before,
      after,
    }
  },
  async buildLog({ input, result }) {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('documents.audit.documentInstantiated', 'Create document from template'),
      resourceKind: DOCUMENTS_ENTITY_IDS.document,
      resourceId: result.id,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      snapshotBefore: result.before,
      snapshotAfter: result.after,
      payload: {
        undo: {
          before: result.before,
          after: result.after,
        } satisfies InstantiateUndoPayload,
      },
    }
  },
  async undo({ logEntry, ctx }) {
    const after = extractUndoPayload<InstantiateUndoPayload>(logEntry)?.after
    if (!after) return
    const redoInput = logEntry.commandPayload && typeof logEntry.commandPayload === 'object'
      ? (logEntry.commandPayload as { __redoInput?: unknown }).__redoInput
      : null
    const input = instantiateDocumentCommandSchema.parse(redoInput)
    const em = resolveDocumentsCommandEntityManager(ctx)
    const scope = resolveDocumentsCommandScope(ctx, input)
    let deletedLinks: DocumentEntityLink[] = []
    let deletedDocument: Document | null = null
    await withAtomicFlush(em, [async () => {
      // Authorization, optimistic validation, and deletion all run while the
      // same aggregate rows are locked. In particular, a collab materializer
      // cannot update DocumentContent between validation and soft deletion.
      const aggregate = await loadAggregate(
        em,
        input,
        true,
        async () => {
          const features = await assertDocumentCommandCanEdit(ctx, em, input.documentId, scope)
          assertCommandFeature(features, 'documents.create')
          assertCommandFeature(features, 'documents.delete')
          assertInstantiateSlotFeatures(dedupeTemplateLinkSlots(input.slots), features)
        },
      )
      assertInstantiateEntityUnchanged(
        aggregate.document,
        { updatedAt: after.documentUpdatedAt, deletedAt: after.documentDeletedAt },
        DOCUMENTS_ENTITY_IDS.document,
        input.documentId,
      )
      assertInstantiateEntityUnchanged(
        aggregate.content,
        { updatedAt: after.contentUpdatedAt, deletedAt: after.contentDeletedAt },
        DOCUMENTS_ENTITY_IDS.documentContent,
        after.contentId,
      )
      if (aggregate.linksById.size !== after.links.length) {
        throw new CrudHttpError(409, { error: 'Record changed by another user' })
      }
      for (const expectedLink of after.links) {
        assertInstantiateEntityUnchanged(
          aggregate.linksById.get(expectedLink.id) ?? null,
          expectedLink,
          DOCUMENTS_ENTITY_IDS.documentEntityLink,
          expectedLink.id,
        )
      }
      await assertNoPostCreateDocumentDependents(em, input.documentId, scope, {
        allowedLinkIds: after.links.map((link) => link.id),
      })

      deletedLinks = Array.from(aggregate.linksById.values())
      deletedDocument = aggregate.document
      if (aggregate.document) {
        const documentVersion = nextDocumentVersion(aggregate.document.updatedAt)
        aggregate.document.deletedAt = documentVersion
        aggregate.document.updatedAt = documentVersion
      }
      if (aggregate.content) {
        const contentVersion = nextDocumentVersion(aggregate.content.updatedAt)
        advanceDocumentCollaborationGeneration(aggregate.content)
        aggregate.content.deletedAt = contentVersion
        aggregate.content.updatedAt = contentVersion
      }
      for (const link of deletedLinks) {
        const linkVersion = nextDocumentVersion(link.updatedAt)
        link.deletedAt = linkVersion
        link.updatedAt = linkVersion
      }
    }], { transaction: true, label: 'documents.document.instantiate.undo' })
    if (deletedLinks.length > 0) {
      await Promise.all(deletedLinks.map((link) => bufferLinkMutationSideEffects(
        ctx,
        'deleted',
        link,
        { undo: true },
      )))
    }
    if (deletedDocument) {
      await bufferDocumentMutationSideEffects(ctx, 'deleted', deletedDocument, { undo: true })
    }
  },
}

registerCommand(instantiateDocumentCommand)

export { instantiateDocumentCommand }
