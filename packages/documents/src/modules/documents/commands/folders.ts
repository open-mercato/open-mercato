import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { hasAllFeatures } from '@open-mercato/shared/lib/auth/featureMatch'
import { DocumentFolder } from '../data/entities'
import { documentFolderCreateSchema, documentFolderUpdateSchema } from '../data/validators'
import { DOCUMENTS_ENTITY_IDS, DOCUMENTS_MAX_FOLDERS_PER_ORGANIZATION } from '../lib/constants'
import { acquireFolderHierarchyMutationLock } from '../lib/folderHierarchySerialization'
import { getFolderPlacementIssue, hasActiveFolderContents } from '../lib/visibility'
import {
  assertCommandFeature,
  resolveDocumentsCommandActor,
  resolveDocumentsCommandEntityManager,
  resolveDocumentsCommandFeatures,
  resolveDocumentsCommandScope,
  type DocumentsCommandScope,
} from './shared'
import {
  assertVersionedSnapshot,
  documentsScopedCommandSchema,
  nextDocumentVersion,
  readCommandRedoInput,
} from './mutation-helpers'

const folderSnapshotSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string(),
  parentFolderId: z.string().uuid().nullable(),
  ownerUserId: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
})

const folderUpdateRedoExpectationSchema = z.object({
  kind: z.literal('folder-update-post-undo'),
  folder: folderSnapshotSchema,
})

const folderDeleteRedoExpectationSchema = z.object({
  kind: z.literal('folder-delete-post-undo'),
  folder: folderSnapshotSchema,
})

export const folderCreateCommandSchema = documentsScopedCommandSchema
  .merge(documentFolderCreateSchema)
  .extend({ folderId: z.string().uuid() })

export const folderUpdateCommandSchema = documentsScopedCommandSchema
  .merge(documentFolderUpdateSchema)
  .extend({ redoExpectation: folderUpdateRedoExpectationSchema.optional() })

export const folderDeleteCommandSchema = documentsScopedCommandSchema.extend({
  id: z.string().uuid(),
  redoExpectation: folderDeleteRedoExpectationSchema.optional(),
})

export type FolderCreateCommandInput = z.infer<typeof folderCreateCommandSchema>
export type FolderUpdateCommandInput = z.infer<typeof folderUpdateCommandSchema>
export type FolderDeleteCommandInput = z.infer<typeof folderDeleteCommandSchema>

type FolderSnapshot = z.infer<typeof folderSnapshotSchema>

type FolderUndoPayload = {
  before?: FolderSnapshot | null
  after?: FolderSnapshot | null
}

type FolderCommandResult = {
  id: string
  updatedAt: string
  before: FolderSnapshot | null
  after: FolderSnapshot
}

function snapshotFolder(folder: DocumentFolder | null): FolderSnapshot | null {
  if (!folder) return null
  return {
    id: folder.id,
    tenantId: folder.tenantId,
    organizationId: folder.organizationId,
    name: folder.name,
    parentFolderId: folder.parentFolderId ?? null,
    ownerUserId: folder.ownerUserId,
    createdAt: folder.createdAt.toISOString(),
    updatedAt: folder.updatedAt.toISOString(),
    deletedAt: folder.deletedAt?.toISOString() ?? null,
  }
}

function changedError(): CrudHttpError {
  return new CrudHttpError(409, { error: 'Record changed by another user' })
}

function nextSnapshotVersion(updatedAt: string): string {
  return nextDocumentVersion(new Date(updatedAt), new Date(0)).toISOString()
}

function assertFolderStateMatches(folder: DocumentFolder, expected: FolderSnapshot): void {
  if (!isDeepStrictEqual(snapshotFolder(folder), expected)) throw changedError()
}

function resolveExactUndoVersion(current: Date, expectedUpdatedAt?: string): Date {
  if (!expectedUpdatedAt) return nextDocumentVersion(current)
  const expected = new Date(expectedUpdatedAt)
  if (!Number.isFinite(expected.getTime()) || expected.getTime() <= current.getTime()) {
    throw changedError()
  }
  return expected
}

function buildFolderUpdateRedoExpectation(
  before: FolderSnapshot,
  after: FolderSnapshot,
): z.infer<typeof folderUpdateRedoExpectationSchema> {
  return {
    kind: 'folder-update-post-undo',
    folder: { ...before, updatedAt: nextSnapshotVersion(after.updatedAt) },
  }
}

function buildFolderDeleteRedoExpectation(
  before: FolderSnapshot,
  after: FolderSnapshot,
): z.infer<typeof folderDeleteRedoExpectationSchema> {
  return {
    kind: 'folder-delete-post-undo',
    folder: { ...before, updatedAt: nextSnapshotVersion(after.updatedAt) },
  }
}

async function loadLockedFolder(
  em: EntityManager,
  id: string,
  scope: DocumentsCommandScope,
  includeDeleted = false,
): Promise<DocumentFolder | null> {
  return findOneWithDecryption(
    em,
    DocumentFolder,
    {
      id,
      ...scope,
      ...(includeDeleted ? {} : { deletedAt: null }),
    },
    {
      lockMode: LockMode.PESSIMISTIC_WRITE,
      ...(includeDeleted ? { filters: false } : {}),
    },
    scope,
  )
}

async function assertFolderOwnerOrManager(
  ownerUserId: string,
  actorUserId: string,
  features: readonly string[],
): Promise<void> {
  if (ownerUserId === actorUserId || hasAllFeatures(['documents.manage'], Array.from(features))) return
  throw new CrudHttpError(403, { error: 'Forbidden' })
}

async function assertWritableParent(
  em: EntityManager,
  parentFolderId: string | null | undefined,
  scope: DocumentsCommandScope,
  actorUserId: string,
  features: readonly string[],
): Promise<void> {
  if (!parentFolderId) return
  const parent = await loadLockedFolder(em, parentFolderId, scope)
  if (!parent) throw new CrudHttpError(404, { error: 'documents.folders.notFound' })
  await assertFolderOwnerOrManager(parent.ownerUserId, actorUserId, features)
}

/**
 * Call only while holding the folder hierarchy mutation lock, so the count and
 * the insert that follows it cannot interleave with a competing create.
 */
async function assertOrganizationFolderCapacity(
  em: EntityManager,
  scope: DocumentsCommandScope,
): Promise<void> {
  const activeCount = await em.count(DocumentFolder, { ...scope, deletedAt: null })
  if (activeCount < DOCUMENTS_MAX_FOLDERS_PER_ORGANIZATION) return
  throw new CrudHttpError(422, { error: 'documents.errors.folderLimitReached' })
}

async function assertValidPlacement(
  em: EntityManager,
  scope: DocumentsCommandScope,
  folderId: string | null,
  parentFolderId: string | null,
): Promise<void> {
  const issue = await getFolderPlacementIssue({ em, ...scope, folderId, parentFolderId })
  if (issue) throw new CrudHttpError(400, { error: 'documents.folders.error.invalidPlacement' })
}

function applyFolderSnapshot(
  folder: DocumentFolder,
  snapshot: FolderSnapshot,
  expectedUpdatedAt?: string,
): void {
  folder.name = snapshot.name
  folder.parentFolderId = snapshot.parentFolderId
  folder.ownerUserId = snapshot.ownerUserId
  folder.deletedAt = snapshot.deletedAt ? new Date(snapshot.deletedAt) : null
  folder.updatedAt = resolveExactUndoVersion(folder.updatedAt, expectedUpdatedAt)
}

function buildFolderLog(
  actionLabel: string,
  input: DocumentsCommandScope,
  result: FolderCommandResult,
  redoInput?: FolderUpdateCommandInput | FolderDeleteCommandInput,
) {
  return {
    actionLabel,
    resourceKind: DOCUMENTS_ENTITY_IDS.documentFolder,
    resourceId: result.id,
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    snapshotBefore: result.before,
    snapshotAfter: result.after,
    payload: {
      undo: { before: result.before, after: result.after } satisfies FolderUndoPayload,
      ...(redoInput ? { __redoInput: redoInput } : {}),
    },
  }
}

const createFolderCommand: CommandHandler<FolderCreateCommandInput, FolderCommandResult> = {
  id: 'documents.folder.create',
  async execute(rawInput, ctx) {
    const input = folderCreateCommandSchema.parse(rawInput)
    const scope = resolveDocumentsCommandScope(ctx, input)
    const actorUserId = resolveDocumentsCommandActor(ctx)
    const em = resolveDocumentsCommandEntityManager(ctx)
    let folder!: DocumentFolder
    let before: FolderSnapshot | null = null
    await withAtomicFlush(em, [async () => {
      await acquireFolderHierarchyMutationLock(em, scope)
      const existing = await loadLockedFolder(em, input.folderId, scope, true)
      const features = await resolveDocumentsCommandFeatures(ctx, scope)
      assertCommandFeature(features, 'documents.edit')
      before = snapshotFolder(existing)
      if (existing && !existing.deletedAt) {
        throw new CrudHttpError(409, { error: 'Record changed by another user' })
      }
      // Reviving a soft-deleted row adds an active folder just like a fresh
      // insert, so both paths answer to the same organization-wide cap. Undo
      // stays exempt: it only restores state the organization already held.
      await assertOrganizationFolderCapacity(em, scope)
      await assertWritableParent(em, input.parentFolderId ?? null, scope, actorUserId, features)
      await assertValidPlacement(em, scope, null, input.parentFolderId ?? null)
      folder = existing ?? em.create(DocumentFolder, {
        id: input.folderId,
        ...scope,
        name: input.name,
        parentFolderId: input.parentFolderId ?? null,
        ownerUserId: actorUserId,
      })
      if (!existing) em.persist(folder)
      folder.name = input.name
      folder.parentFolderId = input.parentFolderId ?? null
      folder.ownerUserId = actorUserId
      folder.deletedAt = null
      if (existing) folder.updatedAt = nextDocumentVersion(folder.updatedAt)
    }], { transaction: true, label: 'documents.folder.create' })
    return {
      id: folder.id,
      updatedAt: folder.updatedAt.toISOString(),
      before,
      after: snapshotFolder(folder)!,
    }
  },
  async buildLog({ input, result }) {
    const { translate } = await resolveTranslations()
    return buildFolderLog(
      translate('documents.audit.folderCreated', 'Create folder'),
      input,
      result,
    )
  },
  async undo({ logEntry, ctx }) {
    const undo = extractUndoPayload<FolderUndoPayload>(logEntry)
    if (!undo?.after) return
    const input = folderCreateCommandSchema.parse(readCommandRedoInput(logEntry))
    const scope = resolveDocumentsCommandScope(ctx, input)
    const actorUserId = resolveDocumentsCommandActor(ctx)
    const em = resolveDocumentsCommandEntityManager(ctx)
    await withAtomicFlush(em, [async () => {
      await acquireFolderHierarchyMutationLock(em, scope)
      const folder = await loadLockedFolder(em, input.folderId, scope, true)
      const features = await resolveDocumentsCommandFeatures(ctx, scope)
      assertCommandFeature(features, 'documents.edit')
      await assertFolderOwnerOrManager(undo.after!.ownerUserId, actorUserId, features)
      assertVersionedSnapshot(folder, undo.after, DOCUMENTS_ENTITY_IDS.documentFolder)
      if (await hasActiveFolderContents({ em, ...scope, folderId: input.folderId })) {
        throw new CrudHttpError(409, { error: 'Record changed by another user' })
      }
      if (undo.before && folder) applyFolderSnapshot(folder, undo.before)
      else if (folder) {
        const now = nextDocumentVersion(folder.updatedAt)
        folder.deletedAt = now
        folder.updatedAt = now
      }
    }], { transaction: true, label: 'documents.folder.create.undo' })
  },
}

const updateFolderCommand: CommandHandler<FolderUpdateCommandInput, FolderCommandResult> = {
  id: 'documents.folder.update',
  async execute(rawInput, ctx) {
    const input = folderUpdateCommandSchema.parse(rawInput)
    const scope = resolveDocumentsCommandScope(ctx, input)
    const actorUserId = resolveDocumentsCommandActor(ctx)
    const em = resolveDocumentsCommandEntityManager(ctx)
    let folder!: DocumentFolder
    let before!: FolderSnapshot
    await withAtomicFlush(em, [async () => {
      await acquireFolderHierarchyMutationLock(em, scope)
      const loaded = await loadLockedFolder(
        em,
        input.id,
        scope,
        input.redoExpectation !== undefined,
      )
      if (!loaded) throw new CrudHttpError(404, { error: 'documents.folders.notFound' })
      folder = loaded
      const features = await resolveDocumentsCommandFeatures(ctx, scope)
      assertCommandFeature(features, 'documents.edit')
      await assertFolderOwnerOrManager(folder.ownerUserId, actorUserId, features)
      if (input.redoExpectation) {
        assertFolderStateMatches(folder, input.redoExpectation.folder)
      } else {
        await enforceCommandOptimisticLockWithGuards(ctx.container, {
          resourceKind: DOCUMENTS_ENTITY_IDS.documentFolder,
          resourceId: folder.id,
          current: folder.updatedAt,
          request: ctx.request ?? null,
        })
      }
      before = snapshotFolder(folder)!
      if (Object.prototype.hasOwnProperty.call(input, 'parentFolderId')) {
        await assertWritableParent(em, input.parentFolderId ?? null, scope, actorUserId, features)
        await assertValidPlacement(em, scope, folder.id, input.parentFolderId ?? null)
      }
      if (input.name !== undefined) folder.name = input.name
      if (Object.prototype.hasOwnProperty.call(input, 'parentFolderId')) {
        folder.parentFolderId = input.parentFolderId ?? null
      }
      folder.updatedAt = nextDocumentVersion(folder.updatedAt)
    }], { transaction: true, label: 'documents.folder.update' })
    return {
      id: folder.id,
      updatedAt: folder.updatedAt.toISOString(),
      before,
      after: snapshotFolder(folder)!,
    }
  },
  async buildLog({ input, result }) {
    const { translate } = await resolveTranslations()
    if (!result.before) throw new Error('[internal] folder update produced no before snapshot')
    const redoInput: FolderUpdateCommandInput = {
      ...input,
      redoExpectation: buildFolderUpdateRedoExpectation(result.before, result.after),
    }
    return buildFolderLog(
      translate('documents.audit.folderUpdated', 'Update folder'),
      input,
      result,
      redoInput,
    )
  },
  async undo({ logEntry, ctx }) {
    const undo = extractUndoPayload<FolderUndoPayload>(logEntry)
    if (!undo?.before || !undo.after) return
    const before = undo.before
    const after = undo.after
    const input = folderUpdateCommandSchema.parse(readCommandRedoInput(logEntry))
    const scope = resolveDocumentsCommandScope(ctx, input)
    const actorUserId = resolveDocumentsCommandActor(ctx)
    const em = resolveDocumentsCommandEntityManager(ctx)
    await withAtomicFlush(em, [async () => {
      await acquireFolderHierarchyMutationLock(em, scope)
      const folder = await loadLockedFolder(em, input.id, scope)
      if (!folder) throw new CrudHttpError(404, { error: 'documents.folders.notFound' })
      const features = await resolveDocumentsCommandFeatures(ctx, scope)
      assertCommandFeature(features, 'documents.edit')
      await assertFolderOwnerOrManager(folder.ownerUserId, actorUserId, features)
      assertVersionedSnapshot(folder, after, DOCUMENTS_ENTITY_IDS.documentFolder)
      await assertWritableParent(em, before.parentFolderId, scope, actorUserId, features)
      await assertValidPlacement(em, scope, folder.id, before.parentFolderId)
      applyFolderSnapshot(
        folder,
        before,
        input.redoExpectation?.folder.updatedAt,
      )
    }], { transaction: true, label: 'documents.folder.update.undo' })
  },
}

const deleteFolderCommand: CommandHandler<FolderDeleteCommandInput, FolderCommandResult> = {
  id: 'documents.folder.delete',
  async execute(rawInput, ctx) {
    const input = folderDeleteCommandSchema.parse(rawInput)
    const scope = resolveDocumentsCommandScope(ctx, input)
    const actorUserId = resolveDocumentsCommandActor(ctx)
    const em = resolveDocumentsCommandEntityManager(ctx)
    let folder!: DocumentFolder
    let before!: FolderSnapshot
    await withAtomicFlush(em, [async () => {
      await acquireFolderHierarchyMutationLock(em, scope)
      const loaded = await loadLockedFolder(
        em,
        input.id,
        scope,
        input.redoExpectation !== undefined,
      )
      if (!loaded) throw new CrudHttpError(404, { error: 'documents.folders.notFound' })
      folder = loaded
      const features = await resolveDocumentsCommandFeatures(ctx, scope)
      assertCommandFeature(features, 'documents.edit')
      await assertFolderOwnerOrManager(folder.ownerUserId, actorUserId, features)
      if (input.redoExpectation) {
        assertFolderStateMatches(folder, input.redoExpectation.folder)
      } else {
        await enforceCommandOptimisticLockWithGuards(ctx.container, {
          resourceKind: DOCUMENTS_ENTITY_IDS.documentFolder,
          resourceId: folder.id,
          current: folder.updatedAt,
          request: ctx.request ?? null,
        })
      }
      before = snapshotFolder(folder)!
      if (await hasActiveFolderContents({ em, ...scope, folderId: folder.id })) {
        throw new CrudHttpError(409, { error: 'documents.folders.error.delete' })
      }
      const now = nextDocumentVersion(folder.updatedAt)
      folder.deletedAt = now
      folder.updatedAt = now
    }], { transaction: true, label: 'documents.folder.delete' })
    return {
      id: folder.id,
      updatedAt: folder.updatedAt.toISOString(),
      before,
      after: snapshotFolder(folder)!,
    }
  },
  async buildLog({ input, result }) {
    const { translate } = await resolveTranslations()
    if (!result.before) throw new Error('[internal] folder delete produced no before snapshot')
    const redoInput: FolderDeleteCommandInput = {
      ...input,
      redoExpectation: buildFolderDeleteRedoExpectation(result.before, result.after),
    }
    return buildFolderLog(
      translate('documents.audit.folderDeleted', 'Delete folder'),
      input,
      result,
      redoInput,
    )
  },
  async undo({ logEntry, ctx }) {
    const undo = extractUndoPayload<FolderUndoPayload>(logEntry)
    if (!undo?.before || !undo.after) return
    const input = folderDeleteCommandSchema.parse(readCommandRedoInput(logEntry))
    const scope = resolveDocumentsCommandScope(ctx, input)
    const actorUserId = resolveDocumentsCommandActor(ctx)
    const em = resolveDocumentsCommandEntityManager(ctx)
    await withAtomicFlush(em, [async () => {
      await acquireFolderHierarchyMutationLock(em, scope)
      const folder = await loadLockedFolder(em, input.id, scope, true)
      const features = await resolveDocumentsCommandFeatures(ctx, scope)
      assertCommandFeature(features, 'documents.edit')
      await assertFolderOwnerOrManager(undo.before!.ownerUserId, actorUserId, features)
      assertVersionedSnapshot(folder, undo.after, DOCUMENTS_ENTITY_IDS.documentFolder)
      await assertWritableParent(em, undo.before!.parentFolderId, scope, actorUserId, features)
      await assertValidPlacement(em, scope, input.id, undo.before!.parentFolderId)
      if (folder) {
        applyFolderSnapshot(
          folder,
          undo.before!,
          input.redoExpectation?.folder.updatedAt,
        )
      }
    }], { transaction: true, label: 'documents.folder.delete.undo' })
  },
}

registerCommand(createFolderCommand)
registerCommand(updateFolderCommand)
registerCommand(deleteFolderCommand)

export { createFolderCommand, updateFolderCommand, deleteFolderCommand }
