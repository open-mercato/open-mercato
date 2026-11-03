import type { EntityManager } from '@mikro-orm/postgresql'
import { DocumentContent } from '../data/entities'
import {
  pinDocumentContentUpdatedAt,
  type RestoreVersionCommandInput,
} from '../commands/versions'

const input: RestoreVersionCommandInput = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
  documentId: '33333333-3333-4333-8333-333333333333',
  versionId: '44444444-4444-4444-8444-444444444444',
  preRestoreVersionId: '55555555-5555-4555-8555-555555555555',
  actorUserId: '77777777-7777-4777-8777-777777777777',
  expectedContentUpdatedAt: '2026-07-10T10:00:00.000Z',
  restoreContentUpdatedAt: '2026-07-10T10:00:00.001Z',
}

describe('version restore optimistic-lock token', () => {
  it('pins the scheduled token after ORM update hooks and refreshes the managed row', async () => {
    const content = Object.assign(new DocumentContent(), {
      id: '88888888-8888-4888-8888-888888888888',
      documentId: input.documentId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      updatedAt: new Date('2026-07-10T10:00:00.900Z'),
    })
    const nativeUpdate = jest.fn(async (_entity, _where, data: { updatedAt: Date }) => {
      content.updatedAt = data.updatedAt
      return 1
    })
    const refresh = jest.fn(async () => undefined)
    const em = { nativeUpdate, refresh } as unknown as EntityManager

    await pinDocumentContentUpdatedAt(em, content, input, input.restoreContentUpdatedAt)

    expect(nativeUpdate).toHaveBeenCalledWith(
      DocumentContent,
      {
        id: content.id,
        documentId: input.documentId,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        deletedAt: null,
      },
      { updatedAt: new Date(input.restoreContentUpdatedAt) },
    )
    expect(refresh).toHaveBeenCalledWith(content)
    expect(content.updatedAt.toISOString()).toBe(input.restoreContentUpdatedAt)
  })

  it('fails closed when the scoped content row disappears before pinning', async () => {
    const content = Object.assign(new DocumentContent(), {
      id: '88888888-8888-4888-8888-888888888888',
      documentId: input.documentId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      updatedAt: new Date(input.restoreContentUpdatedAt),
    })
    const em = {
      nativeUpdate: jest.fn(async () => 0),
      refresh: jest.fn(async () => undefined),
    } as unknown as EntityManager

    await expect(pinDocumentContentUpdatedAt(em, content, input, input.restoreContentUpdatedAt))
      .rejects.toMatchObject({ status: 409 })
  })
})
