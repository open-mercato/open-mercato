jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string, fallback?: string) => fallback ?? key }),
}))
jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/commands/helpers'),
  emitCrudSideEffects: jest.fn(async () => undefined),
  emitCrudUndoSideEffects: jest.fn(async () => undefined),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async (em: { findOne: (entity: unknown, filters: Record<string, unknown>) => Promise<unknown> }, entity: unknown, filters: Record<string, unknown>) => em.findOne(entity, filters)),
}))

import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { CustomerComment, CustomerEntity } from '../../data/entities'
import '../comments'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const commentId = '33333333-3333-4333-8333-333333333333'
const authorId = '44444444-4444-4444-8444-444444444444'
const editorId = '55555555-5555-4555-8555-555555555555'
const targetId = '66666666-6666-4666-8666-666666666666'
const entityId = '77777777-7777-4777-8777-777777777777'

function harness(auth: Record<string, unknown> = {}, author: string | null = authorId) {
  const entity = { id: entityId, kind: 'person', tenantId, organizationId }
  const comment = { id: commentId, tenantId, organizationId, entity, deal: null, body: 'Original', authorUserId: author } as CustomerComment
  const users = [{ id: targetId, tenantId, organizationId, deletedAt: null as Date | null }]
  const em = {
    findOne: jest.fn(async (type: unknown, filters: Record<string, unknown>) => {
      if (type === CustomerComment) return comment
      if (type === CustomerEntity) return entity
      if (type === User) return users.find(user => Object.entries(filters).every(([key, value]) => user[key as keyof typeof user] === value)) ?? null
      return null
    }),
    flush: jest.fn(async () => undefined),
    fork: () => em,
  }
  const ctx = {
    auth: { sub: editorId, tenantId, orgId: organizationId, ...auth },
    selectedOrganizationId: organizationId,
    container: { resolve: (key: string) => key === 'em' ? em : {} },
  } as unknown as CommandRuntimeContext
  return { em, ctx, comment, users }
}

function commentUpdateHandler(): CommandHandler {
  return commandRegistry.get('customers.comments.update') as CommandHandler
}

beforeEach(() => jest.clearAllMocks())

describe('customer comment author attribution (#8759)', () => {
  it.each([
    [{}, targetId], [{}, null], [{ isApiKey: true }, targetId],
    [{ isApiKey: true, isSuperAdmin: true }, targetId], [{ isApiKey: true, isSuperAdmin: true }, null],
  ])('preserves attribution for actor %j and supplied author %s while editing body', async (auth, authorUserId) => {
    const { ctx, comment, em } = harness(auth as Record<string, unknown>)
    await commentUpdateHandler().execute({ id: commentId, body: 'Edited', authorUserId }, ctx)
    expect(comment).toMatchObject({ body: 'Edited', authorUserId: authorId })
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(emitCrudSideEffects).toHaveBeenCalledWith(expect.objectContaining({ action: 'updated', entity: comment }))
    expect(findOneWithDecryption).not.toHaveBeenCalled()
  })

  it.each([{}, { isSuperAdmin: true }, { isApiKey: true }])('preserves omission for %j even when editor differs', async auth => {
    const { ctx, comment } = harness(auth)
    await commentUpdateHandler().execute({ id: commentId, body: 'Edited' }, ctx)
    expect(comment.authorUserId).toBe(authorId)
  })

  it('does not invent an author for an unattributed comment', async () => {
    const { ctx, comment } = harness({}, null)
    await commentUpdateHandler().execute({ id: commentId, body: 'Edited', authorUserId: targetId }, ctx)
    expect(comment.authorUserId).toBeNull()
  })

  it('allows a scoped privileged author and explicit clearing', async () => {
    const { ctx, comment, em } = harness({ isSuperAdmin: true })
    await commentUpdateHandler().execute({ id: commentId, authorUserId: targetId }, ctx)
    expect(comment.authorUserId).toBe(targetId)
    expect(findOneWithDecryption).toHaveBeenCalledWith(em, User, { id: targetId, tenantId, deletedAt: null }, undefined, { tenantId, organizationId })
    await commentUpdateHandler().execute({ id: commentId, authorUserId: null }, ctx)
    expect(comment.authorUserId).toBeNull()
  })

  it.each(['tenantId', 'deletedAt', 'id'] as const)('rejects a privileged target with invalid %s before mutation', async field => {
    const { ctx, comment, users, em } = harness({ isSuperAdmin: true })
    Object.assign(users[0], { [field]: field === 'deletedAt' ? new Date() : editorId })
    await expect(commentUpdateHandler().execute({ id: commentId, body: 'Must not persist', authorUserId: targetId }, ctx)).rejects.toMatchObject({ status: 400 })
    expect(comment).toMatchObject({ body: 'Original', authorUserId: authorId })
    expect(em.flush).not.toHaveBeenCalled()
    expect(emitCrudSideEffects).not.toHaveBeenCalled()
  })

  it('allows a privileged target with another home organization in the same tenant', async () => {
    const { ctx, comment, users } = harness({ isSuperAdmin: true })
    users[0].organizationId = editorId
    await commentUpdateHandler().execute({ id: commentId, authorUserId: targetId }, ctx)
    expect(comment.authorUserId).toBe(targetId)
  })

  it('preserves an unchanged historical author for a privileged editor without a target lookup', async () => {
    const { ctx, comment } = harness({ isSuperAdmin: true })
    await commentUpdateHandler().execute({ id: commentId, body: 'History', authorUserId: authorId }, ctx)
    expect(comment).toMatchObject({ body: 'History', authorUserId: authorId })
    expect(findOneWithDecryption).not.toHaveBeenCalled()
  })

  it.each(['tenantId', 'organizationId'])('retains the comment %s denial', async field => {
    const { ctx, comment, em } = harness()
    Object.assign(comment, { [field]: targetId })
    await expect(commentUpdateHandler().execute({ id: commentId, body: 'Denied' }, ctx)).rejects.toMatchObject({ status: 403 })
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('captures unchanged attribution and restores the original body and author on undo', async () => {
    const { ctx, comment } = harness()
    const handler = commentUpdateHandler()
    const snapshots = await handler.prepare!({ id: commentId }, ctx)
    await handler.execute({ id: commentId, body: 'Edited', authorUserId: targetId }, ctx)
    const after = await handler.captureAfter!({ id: commentId }, { commentId }, ctx)
    expect(after).toMatchObject({ authorUserId: authorId, body: 'Edited' })
    const log = await handler.buildLog!({ input: { id: commentId }, result: { commentId }, ctx, snapshots: { ...snapshots, after } } as never)
    await handler.undo!({ input: {}, ctx, logEntry: { commandPayload: log?.payload } as never })
    expect(comment).toMatchObject({ authorUserId: authorId, body: 'Original' })
  })
})
