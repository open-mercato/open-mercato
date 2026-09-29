import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(async () => []),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

jest.mock('../commands/shared', () => ({
  assertCommandFeature: jest.fn(),
  assertDocumentCommandCapability: jest.fn(async () => undefined),
  resolveDocumentsCommandActor: (ctx: { auth?: { sub?: string } | null }) => ctx.auth?.sub ?? null,
  resolveDocumentsCommandFeatures: jest.fn(async () => ['documents.templates.manage']),
  resolveDocumentsCommandScope: (_ctx: unknown, input: { tenantId: string; organizationId: string }) => ({
    tenantId: input.tenantId,
    organizationId: input.organizationId,
  }),
}))

jest.mock('../lib/permissions', () => ({
  resolveUserAccess: jest.fn(),
}))

import { resolveUserAccess } from '../lib/permissions'
import { assertDocumentCommandCapability } from '../commands/shared'
import { Document, DocumentComment, DocumentShare, DocumentTemplate } from '../data/entities'
import {
  updateShareCommand,
  type ShareUpdateCommandInput,
} from '../commands/shares'
import {
  createCommentCommand,
  type CommentCreateCommandInput,
} from '../commands/comments'
import {
  updateTemplateCommand,
  type TemplateUpdateCommandInput,
} from '../commands/templates'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const DOCUMENT_ID = '44444444-4444-4444-8444-444444444444'
const RESOURCE_ID = '55555555-5555-4555-8555-555555555555'
const PRINCIPAL_ID = '66666666-6666-4666-8666-666666666666'
const SHARE_ID = '77777777-7777-4777-8777-777777777777'
const UPDATED_AT = new Date('2026-07-10T10:00:00.000Z')
const LATER_AT = new Date('2026-07-10T11:00:00.000Z')

type FakeEntityManager = EntityManager & {
  create: jest.Mock
  persist: jest.Mock
}

function fakeEntityManager(onCreate?: (entity: unknown, data: Record<string, unknown>) => object): FakeEntityManager {
  return {
    begin: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
    flush: jest.fn(async () => undefined),
    count: jest.fn(async () => 0),
    isInTransaction: jest.fn(() => false),
    create: jest.fn((entity: unknown, data: Record<string, unknown>) => onCreate?.(entity, data) ?? { ...data }),
    persist: jest.fn(),
  } as unknown as FakeEntityManager
}

function commandContext(em: EntityManager): CommandRuntimeContext {
  return {
    container: { resolve: (name: string) => name === 'authPrincipalService'
      ? {
          principalExists: jest.fn(async () => true),
          resolveActiveUserRoleIds: jest.fn(),
          filterActiveRoleIds: jest.fn(),
          resolveLabels: jest.fn(),
          listSuperAdminUserIds: jest.fn(),
        }
      : em },
    auth: { sub: USER_ID },
    organizationScope: null,
    selectedOrganizationId: ORGANIZATION_ID,
    organizationIds: [ORGANIZATION_ID],
    transactionalEm: em,
  } as unknown as CommandRuntimeContext
}

function commandPayload(metadata: { payload?: unknown } | null | undefined): Record<string, unknown> {
  return (metadata?.payload ?? {}) as Record<string, unknown>
}

describe('documents transactional mutation snapshots', () => {
  const findOne = findOneWithDecryption as jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers({ now: new Date('2020-01-01T00:00:00.000Z') })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('keeps the share log at transaction state after a post-execute mutation and rejects missing-row undo', async () => {
    const document = { id: DOCUMENT_ID, title: 'Document' } as Document
    let share: DocumentShare | null = {
      id: RESOURCE_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      documentId: DOCUMENT_ID,
      principalType: 'user',
      principalId: PRINCIPAL_ID,
      permission: 'viewer',
      createdByUserId: USER_ID,
      deletedAt: null,
      createdAt: UPDATED_AT,
      updatedAt: UPDATED_AT,
    } as DocumentShare
    findOne.mockImplementation(async (_em: unknown, entity: unknown) => {
      if (entity === Document) return document
      if (entity === DocumentShare) return share
      return null
    })
    const em = fakeEntityManager()
    const ctx = commandContext(em)
    const input: ShareUpdateCommandInput = {
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      documentId: DOCUMENT_ID,
      actorUserId: USER_ID,
      expectedUpdatedAt: UPDATED_AT.toISOString(),
      share: { id: RESOURCE_ID, permission: 'editor' },
    }

    const result = await updateShareCommand.execute(input, ctx)
    const transactionUpdatedAt = result.after.updatedAt
    expect(Date.parse(transactionUpdatedAt!)).toBeGreaterThan(UPDATED_AT.getTime())
    const metadata = await updateShareCommand.buildLog?.({ input, result, ctx, snapshots: {} })
    const payload = commandPayload(metadata) as {
      __redoInput: ShareUpdateCommandInput
    }
    await updateShareCommand.undo!({ input, ctx, logEntry: { commandPayload: payload } })
    const undoUpdatedAt = (share as DocumentShare).updatedAt.toISOString()
    expect(Date.parse(undoUpdatedAt)).toBeGreaterThan(Date.parse(transactionUpdatedAt!))
    const redone = await updateShareCommand.execute(payload.__redoInput, ctx)
    expect(Date.parse(redone.updatedAt)).toBeGreaterThan(Date.parse(undoUpdatedAt))
    ;(share as DocumentShare).permission = 'viewer'
    ;(share as DocumentShare).updatedAt = LATER_AT

    expect(metadata?.snapshotAfter).toMatchObject({ permission: 'editor', updatedAt: transactionUpdatedAt })
    expect(result.after).toMatchObject({ permission: 'editor', updatedAt: transactionUpdatedAt })
    share = null
    await expect(updateShareCommand.undo!({
      input,
      ctx,
      logEntry: { commandPayload: commandPayload(metadata) },
    })).rejects.toMatchObject({ status: 409 })
  })

  it('keeps the template log at transaction state after a post-execute mutation and rejects missing-row undo', async () => {
    let template: DocumentTemplate | null = {
      id: RESOURCE_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      name: 'Before',
      description: null,
      bodyHtml: '<p>Before</p>',
      contextSlots: null,
      seedKey: null,
      createdByUserId: USER_ID,
      isActive: true,
      deletedAt: null,
      createdAt: UPDATED_AT,
      updatedAt: UPDATED_AT,
    } as DocumentTemplate
    findOne.mockImplementation(async (_em: unknown, entity: unknown) => entity === DocumentTemplate ? template : null)
    const em = fakeEntityManager()
    const ctx = commandContext(em)
    const input: TemplateUpdateCommandInput = {
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      actorUserId: USER_ID,
      expectedUpdatedAt: UPDATED_AT.toISOString(),
      template: { id: RESOURCE_ID, name: 'Transaction value' },
    }

    const result = await updateTemplateCommand.execute(input, ctx)
    const transactionUpdatedAt = result.after.updatedAt
    expect(Date.parse(transactionUpdatedAt!)).toBeGreaterThan(UPDATED_AT.getTime())
    const metadata = await updateTemplateCommand.buildLog?.({ input, result, ctx, snapshots: {} })
    const payload = commandPayload(metadata) as {
      __redoInput: TemplateUpdateCommandInput
    }
    await updateTemplateCommand.undo!({ input, ctx, logEntry: { commandPayload: payload } })
    const undoUpdatedAt = (template as DocumentTemplate).updatedAt.toISOString()
    expect(Date.parse(undoUpdatedAt)).toBeGreaterThan(Date.parse(transactionUpdatedAt!))
    const redone = await updateTemplateCommand.execute(payload.__redoInput, ctx)
    expect(Date.parse(redone.updatedAt)).toBeGreaterThan(Date.parse(undoUpdatedAt))
    ;(template as DocumentTemplate).name = 'Post-commit value'
    ;(template as DocumentTemplate).updatedAt = LATER_AT

    expect(metadata?.snapshotAfter).toMatchObject({ name: 'Transaction value', updatedAt: transactionUpdatedAt })
    expect(result.after).toMatchObject({ name: 'Transaction value', updatedAt: transactionUpdatedAt })
    template = null
    await expect(updateTemplateCommand.undo!({
      input,
      ctx,
      logEntry: { commandPayload: commandPayload(metadata) },
    })).rejects.toMatchObject({ status: 409 })
  })

  it('captures comment and mention-share snapshots in-transaction with one projection per side effect', async () => {
    const document = { id: DOCUMENT_ID, title: 'Document' } as Document
    let comment: DocumentComment | null = null
    let share: DocumentShare | null = null
    findOne.mockImplementation(async (_em: unknown, entity: unknown) => {
      if (entity === Document) return document
      if (entity === DocumentComment) return comment
      if (entity === DocumentShare) return share
      return null
    })
    ;(resolveUserAccess as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('commenter')
    const em = fakeEntityManager((entity, data) => {
      const row = { ...data, createdAt: UPDATED_AT, updatedAt: UPDATED_AT }
      if (entity === DocumentComment) comment = row as DocumentComment
      if (entity === DocumentShare) share = row as DocumentShare
      return row
    })
    const ctx = commandContext(em)
    const input: CommentCreateCommandInput = {
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      documentId: DOCUMENT_ID,
      commentId: RESOURCE_ID,
      actorUserId: USER_ID,
      comment: {
        body: `Review this @[${PRINCIPAL_ID}]`,
        mentions: [{ userId: PRINCIPAL_ID }],
        grantAccessTo: [PRINCIPAL_ID],
        parentCommentId: null,
      },
      grantShares: [{ userId: PRINCIPAL_ID, shareId: SHARE_ID }],
    }

    const result = await createCommentCommand.execute(input, ctx)
    expect(em.count).toHaveBeenCalledWith(DocumentComment, {
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      documentId: DOCUMENT_ID,
      deletedAt: null,
    })
    expect(Date.parse(result.updatedAt)).toBeGreaterThan(UPDATED_AT.getTime())
    expect(Date.parse(result.undo.shareMutations[0]!.after.updatedAt!)).toBeGreaterThan(
      UPDATED_AT.getTime(),
    )
    const transactionBody = result.undo.after?.body
    const metadata = await createCommentCommand.buildLog?.({ input, result, ctx, snapshots: {} })
    const payload = commandPayload(metadata) as {
      __redoInput: CommentCreateCommandInput
    }
    await createCommentCommand.undo!({ input, ctx, logEntry: { commandPayload: payload } })
    const commentUndoUpdatedAt = (comment as DocumentComment).updatedAt.toISOString()
    const shareUndoUpdatedAt = (share as DocumentShare).updatedAt.toISOString()
    expect(Date.parse(commentUndoUpdatedAt)).toBeGreaterThan(Date.parse(result.updatedAt))
    expect(Date.parse(shareUndoUpdatedAt)).toBeGreaterThan(
      Date.parse(result.undo.shareMutations[0]!.after.updatedAt!),
    )
    ;(resolveUserAccess as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('commenter')
    const redone = await createCommentCommand.execute(payload.__redoInput, ctx)
    expect(Date.parse(redone.updatedAt)).toBeGreaterThan(Date.parse(commentUndoUpdatedAt))
    ;(comment as DocumentComment).body = 'Post-commit value'
    ;(comment as DocumentComment).updatedAt = LATER_AT
    const projections = result.projections ?? []

    expect(metadata?.snapshotAfter).toMatchObject({ body: transactionBody })
    expect(projections.filter((entry) => entry.kind === 'event' && entry.eventId === 'documents.comment.created'))
      .toHaveLength(1)
    expect(projections.filter((entry) => entry.kind === 'event' && entry.eventId === 'documents.comment.mentioned'))
      .toHaveLength(1)
    expect(projections.filter((entry) => entry.kind === 'mention-notification')).toHaveLength(1)
    const inverseShare = result.undo.projectionsAfterUndo?.find((entry) => entry.kind === 'event')
    expect(inverseShare?.kind === 'event' ? inverseShare.payload : undefined).not.toHaveProperty('userId')

    comment = null
    await expect(createCommentCommand.undo!({
      input,
      ctx,
      logEntry: { commandPayload: commandPayload(metadata) },
    })).rejects.toMatchObject({ status: 409 })
  })

  it('rejects comment undo after share access is revoked without mutating comment or shares', async () => {
    const document = { id: DOCUMENT_ID, title: 'Document', deletedAt: null } as Document
    const comment = {
      id: RESOURCE_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      documentId: DOCUMENT_ID,
      parentCommentId: null,
      authorUserId: USER_ID,
      body: `Review this @[${PRINCIPAL_ID}]`,
      anchor: null,
      mentions: [{ userId: PRINCIPAL_ID }],
      resolvedAt: null,
      resolvedByUserId: null,
      deletedAt: null,
      createdAt: UPDATED_AT,
      updatedAt: UPDATED_AT,
    } as DocumentComment
    const share = {
      id: SHARE_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      documentId: DOCUMENT_ID,
      principalType: 'user',
      principalId: PRINCIPAL_ID,
      permission: 'commenter',
      createdByUserId: USER_ID,
      deletedAt: null,
      createdAt: UPDATED_AT,
      updatedAt: UPDATED_AT,
    } as DocumentShare
    const input: CommentCreateCommandInput = {
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      documentId: DOCUMENT_ID,
      commentId: RESOURCE_ID,
      actorUserId: USER_ID,
      comment: {
        body: comment.body,
        mentions: [{ userId: PRINCIPAL_ID }],
        grantAccessTo: [PRINCIPAL_ID],
        parentCommentId: null,
      },
      grantShares: [{ userId: PRINCIPAL_ID, shareId: SHARE_ID }],
    }
    findOne.mockImplementation(async (_em: unknown, entity: unknown) => {
      if (entity === Document) return document
      if (entity === DocumentComment) return comment
      if (entity === DocumentShare) return share
      return null
    })
    ;(assertDocumentCommandCapability as jest.Mock).mockRejectedValueOnce(
      new CrudHttpError(403, { error: 'Forbidden' }),
    )
    const em = fakeEntityManager()
    const ctx = commandContext(em)
    const commentAfter = {
      id: RESOURCE_ID,
      existed: true,
      parentCommentId: null,
      authorUserId: USER_ID,
      body: comment.body,
      anchor: null,
      mentions: [{ userId: PRINCIPAL_ID }],
      resolvedAt: null,
      resolvedByUserId: null,
      deletedAt: null,
      updatedAt: UPDATED_AT.toISOString(),
    }
    const shareAfter = {
      id: SHARE_ID,
      userId: PRINCIPAL_ID,
      existed: true,
      permission: 'commenter' as const,
      createdByUserId: USER_ID,
      deletedAt: null,
      updatedAt: UPDATED_AT.toISOString(),
    }

    await expect(createCommentCommand.undo!({
      input,
      ctx,
      logEntry: {
        commandPayload: {
          __redoInput: input,
          undo: {
            before: { ...commentAfter, existed: false, updatedAt: null },
            after: commentAfter,
            shareMutations: [{
              before: { ...shareAfter, existed: false, updatedAt: null },
              after: shareAfter,
            }],
          },
        },
      },
    })).rejects.toMatchObject({ status: 403 })

    expect(assertDocumentCommandCapability).toHaveBeenCalledWith(
      ctx,
      em,
      DOCUMENT_ID,
      { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      'canShare',
    )
    expect(em.commit).not.toHaveBeenCalled()
    expect(em.rollback).toHaveBeenCalledTimes(1)
    expect(em.flush).not.toHaveBeenCalled()
    expect(comment.deletedAt).toBeNull()
    expect(comment.updatedAt).toEqual(UPDATED_AT)
    expect(share.deletedAt).toBeNull()
    expect(share.updatedAt).toEqual(UPDATED_AT)
  })
})
