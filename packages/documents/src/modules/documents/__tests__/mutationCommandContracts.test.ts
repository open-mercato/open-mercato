import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

import {
  createShareCommand,
  deleteShareCommand,
  updateShareCommand,
  type ShareCreateCommandInput,
  type ShareState,
} from '../commands/shares'
import {
  commentCreateCommandSchema,
  createCommentCommand,
  resolveCommentCommand,
  type CommentCreateCommandInput,
  type CommentResolveCommandInput,
  type CommentState,
} from '../commands/comments'
import {
  createTemplateCommand,
  deleteTemplateCommand,
  updateTemplateCommand,
  type TemplateCreateCommandInput,
  type TemplateState,
} from '../commands/templates'
import { resolveDocumentsCommandEntityManager } from '../commands/shared'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const DOCUMENT_ID = '44444444-4444-4444-8444-444444444444'
const RESOURCE_ID = '55555555-5555-4555-8555-555555555555'
const PRINCIPAL_ID = '66666666-6666-4666-8666-666666666666'
const UPDATED_AT = '2026-07-10T10:00:00.000Z'

const ctx = {} as CommandRuntimeContext

function payloadRecord(metadata: Awaited<ReturnType<NonNullable<typeof createShareCommand.buildLog>>>): Record<string, unknown> {
  return (metadata?.payload ?? {}) as Record<string, unknown>
}

describe('documents mutation command contract', () => {
  it('reuses an ambient transactional EntityManager before considering a fork', () => {
    const transactionalEm = { marker: 'transaction' }
    const fork = jest.fn(() => ({ marker: 'fork' }))
    const container = { resolve: jest.fn(() => ({ fork })) }

    expect(resolveDocumentsCommandEntityManager({
      container,
      transactionalEm,
    } as unknown as CommandRuntimeContext)).toBe(transactionalEm)
    expect(container.resolve).not.toHaveBeenCalled()

    expect(resolveDocumentsCommandEntityManager({
      container,
    } as unknown as CommandRuntimeContext)).toEqual({ marker: 'fork' })
    expect(container.resolve).toHaveBeenCalledWith('em')
    expect(fork).toHaveBeenCalledTimes(1)
  })

  it('exports all required singular command ids', () => {
    expect([
      createShareCommand.id,
      updateShareCommand.id,
      deleteShareCommand.id,
      createCommentCommand.id,
      resolveCommentCommand.id,
      createTemplateCommand.id,
      updateTemplateCommand.id,
      deleteTemplateCommand.id,
    ]).toEqual([
      'documents.share.create',
      'documents.share.update',
      'documents.share.delete',
      'documents.comment.create',
      'documents.comment.resolve',
      'documents.template.create',
      'documents.template.update',
      'documents.template.delete',
    ])
  })

  it('keeps share create identity stable and projects the inverse event after undo', async () => {
    const input: ShareCreateCommandInput = {
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      documentId: DOCUMENT_ID,
      shareId: RESOURCE_ID,
      actorUserId: USER_ID,
      expectedUpdatedAt: null,
      share: { principalType: 'user', principalId: PRINCIPAL_ID, permission: 'viewer' },
    }
    const before: ShareState = {
      id: RESOURCE_ID,
      existed: false,
      principalType: 'user',
      principalId: PRINCIPAL_ID,
      permission: 'viewer',
      createdByUserId: USER_ID,
      deletedAt: null,
      updatedAt: null,
    }
    const after: ShareState = { ...before, existed: true, updatedAt: UPDATED_AT }
    const metadata = await createShareCommand.buildLog?.({
      input,
      result: { id: RESOURCE_ID, updatedAt: UPDATED_AT, before, after },
      ctx,
      snapshots: {},
    })
    const payload = payloadRecord(metadata)
    const redo = payload.__redoInput as ShareCreateCommandInput
    const undo = extractUndoPayload<{
      projectionsAfterUndo?: Array<{ kind: string; eventId?: string }>
    }>({ commandPayload: payload })

    expect(redo.shareId).toBe(RESOURCE_ID)
    expect(redo.redoExpectation?.kind).toBe('soft-deleted-created')
    expect(undo?.projectionsAfterUndo).toEqual([
      expect.objectContaining({ kind: 'event', eventId: 'documents.document.unshared' }),
    ])
    expect((undo?.projectionsAfterUndo?.[0] as { payload?: Record<string, unknown> }).payload)
      .not.toHaveProperty('userId')
  })

  it('keeps comment and mention-share ids in the redo envelope', async () => {
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
      grantShares: [{ userId: PRINCIPAL_ID, shareId: '77777777-7777-4777-8777-777777777777' }],
    }
    const before: CommentState = {
      id: RESOURCE_ID,
      existed: false,
      parentCommentId: null,
      authorUserId: USER_ID,
      body: input.comment.body,
      anchor: null,
      mentions: [{ userId: PRINCIPAL_ID }],
      resolvedAt: null,
      resolvedByUserId: null,
      deletedAt: null,
      updatedAt: null,
    }
    const after: CommentState = { ...before, existed: true, updatedAt: UPDATED_AT }
    const metadata = await createCommentCommand.buildLog?.({
      input,
      result: {
        id: RESOURCE_ID,
        updatedAt: UPDATED_AT,
        undo: { before, after, shareMutations: [], projectionsAfterUndo: [] },
      },
      ctx,
      snapshots: { before, after },
    })
    const redo = (metadata?.payload as { __redoInput?: CommentCreateCommandInput }).__redoInput

    expect(redo).toMatchObject({
      commentId: RESOURCE_ID,
      grantShares: [{ userId: PRINCIPAL_ID, shareId: '77777777-7777-4777-8777-777777777777' }],
      redoExpectation: { kind: 'soft-deleted-created' },
    })
  })

  it('rejects an unbound mention-grant identity before command execution', () => {
    expect(() => commentCreateCommandSchema.parse({
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      documentId: DOCUMENT_ID,
      commentId: RESOURCE_ID,
      actorUserId: USER_ID,
      comment: { body: 'Hello', grantAccessTo: [PRINCIPAL_ID] },
      grantShares: [],
    })).toThrow('documents.comments.grantIdentityMismatch')
  })

  it('leaves inverse comment resolution attribution to the undo actor', async () => {
    const input: CommentResolveCommandInput = {
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      documentId: DOCUMENT_ID,
      actorUserId: USER_ID,
      expectedUpdatedAt: UPDATED_AT,
      comment: { id: RESOURCE_ID, resolved: true },
    }
    const before: CommentState = {
      id: RESOURCE_ID,
      existed: true,
      parentCommentId: null,
      authorUserId: USER_ID,
      body: 'Review',
      anchor: null,
      mentions: null,
      resolvedAt: null,
      resolvedByUserId: null,
      deletedAt: null,
      updatedAt: UPDATED_AT,
    }
    const after: CommentState = {
      ...before,
      resolvedAt: '2026-07-10T10:01:00.000Z',
      resolvedByUserId: USER_ID,
      updatedAt: '2026-07-10T10:01:00.000Z',
    }
    const metadata = await resolveCommentCommand.buildLog?.({
      input,
      result: {
        id: RESOURCE_ID,
        resolvedAt: after.resolvedAt,
        resolvedByUserId: after.resolvedByUserId,
        updatedAt: after.updatedAt!,
        before,
        after,
      },
      ctx,
      snapshots: {},
    })
    const undo = extractUndoPayload<{
      projectionsAfterUndo?: Array<{ kind: string; payload?: Record<string, unknown> }>
    }>({ commandPayload: metadata?.payload })

    expect(undo?.projectionsAfterUndo?.[0]?.payload).not.toHaveProperty('userId')
  })

  it('keeps template create identity stable across undo and redo', async () => {
    const input: TemplateCreateCommandInput = {
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      templateId: RESOURCE_ID,
      actorUserId: USER_ID,
      template: { name: 'Review', bodyHtml: '<p>Review</p>' },
    }
    const before: TemplateState = {
      id: RESOURCE_ID,
      existed: false,
      name: 'Review',
      description: null,
      bodyHtml: '<p>Review</p>',
      contextSlots: null,
      seedKey: null,
      createdByUserId: USER_ID,
      isActive: true,
      deletedAt: null,
      updatedAt: null,
    }
    const after: TemplateState = { ...before, existed: true, updatedAt: UPDATED_AT }
    const metadata = await createTemplateCommand.buildLog?.({
      input,
      result: { id: RESOURCE_ID, updatedAt: UPDATED_AT, before, after },
      ctx,
      snapshots: {},
    })
    const redo = (metadata?.payload as { __redoInput?: TemplateCreateCommandInput }).__redoInput

    expect(redo?.templateId).toBe(RESOURCE_ID)
    expect(redo?.redoExpectation?.kind).toBe('soft-deleted-created')
  })
})
