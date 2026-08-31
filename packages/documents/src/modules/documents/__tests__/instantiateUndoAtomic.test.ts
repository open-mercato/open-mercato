import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import {
  Document,
  DocumentAttachment,
  DocumentComment,
  DocumentContent,
  DocumentEntityLink,
  DocumentShare,
  DocumentVersion,
} from '../data/entities'

const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockIsDocumentEntityRegistryModuleEnabled = jest.fn(() => true)
const mockAssertDocumentCommandCanEdit = jest.fn(async () => [
  'documents.create',
  'documents.delete',
  'documents.edit',
  'catalog.products.view',
])

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

jest.mock('../commands/shared', () => {
  const actual = jest.requireActual('../commands/shared')
  return {
    ...actual,
    assertDocumentCommandCanEdit: (...args: unknown[]) => mockAssertDocumentCommandCanEdit(...args),
  }
})

jest.mock('../lib/entityRegistryAvailability.server', () => ({
  isDocumentEntityRegistryModuleEnabled: (...args: unknown[]) => (
    mockIsDocumentEntityRegistryModuleEnabled(...args)
  ),
}))

jest.mock('../events', () => ({
  emitDocumentsEvent: jest.fn(async () => undefined),
}))

import { instantiateDocumentCommand } from '../commands/documents'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const actorUserId = '33333333-3333-4333-8333-333333333333'
const documentId = '44444444-4444-4444-8444-444444444444'
const contentId = '55555555-5555-4555-8555-555555555555'
const templateId = '66666666-6666-4666-8666-666666666666'
const linkId = '77777777-7777-4777-8777-777777777777'
const productId = '88888888-8888-4888-8888-888888888888'
const originalUpdatedAt = '2026-07-10T10:00:00.000Z'
const concurrentUpdatedAt = '2026-07-10T10:00:01.000Z'

function redoInput() {
  return {
    tenantId,
    organizationId,
    documentId,
    contentId,
    templateId,
    linkIds: [linkId],
    createdByUserId: actorUserId,
    title: 'Quarterly review',
    folderId: null,
    locale: 'en',
    effectiveDate: '2026-07-10T10:00:00.000Z',
    templateUpdatedAt: '2026-07-10T10:00:00.000Z',
    slots: [{
      slot: 'product',
      entityType: 'product' as const,
      entityId: productId,
      label: 'Atlas Runner',
      href: `/backend/catalog/products/${productId}`,
      values: {},
    }],
    previewDigest: `sha256:${'a'.repeat(64)}`,
  }
}

function makeContext(em: EntityManager): CommandRuntimeContext {
  const forkable = em as EntityManager & { fork?: () => EntityManager }
  if (typeof forkable.fork !== 'function') forkable.fork = () => em
  return {
    container: {
      resolve: (token: string) => {
        if (token === 'em') return em
        if (token === 'searchIndexer') return { deleteRecord: jest.fn(async () => undefined) }
        throw new Error(`Unexpected dependency: ${token}`)
      },
    } as CommandRuntimeContext['container'],
    auth: {
      sub: actorUserId,
      userId: actorUserId,
      tenantId,
      orgId: organizationId,
      features: ['documents.edit'],
    } as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
  }
}

describe('document template instantiate undo atomicity', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockIsDocumentEntityRegistryModuleEnabled.mockReturnValue(true)
  })

  it('revalidates locked aggregate rows inside the transaction and rejects a concurrent content edit', async () => {
    const order: string[] = []
    const document = {
      id: documentId,
      updatedAt: new Date(originalUpdatedAt),
      deletedAt: null,
    }
    const content = {
      id: contentId,
      documentId,
      updatedAt: new Date(concurrentUpdatedAt),
      deletedAt: null,
    }
    const link = {
      id: linkId,
      documentId,
      updatedAt: new Date(originalUpdatedAt),
      deletedAt: null,
    }
    const em = {
      begin: jest.fn(async () => { order.push('begin') }),
      commit: jest.fn(async () => { order.push('commit') }),
      rollback: jest.fn(async () => { order.push('rollback') }),
      flush: jest.fn(async () => { order.push('flush') }),
    } as unknown as EntityManager
    mockAssertDocumentCommandCanEdit.mockImplementationOnce(async () => {
      order.push('authorize')
      return ['documents.create', 'documents.delete', 'documents.edit', 'catalog.products.view']
    })
    mockFindOneWithDecryption.mockImplementation(async (
      _em: EntityManager,
      entity: unknown,
      _where: unknown,
      options: { lockMode?: LockMode },
    ) => {
      order.push(entity === Document ? 'read-document' : 'read-content')
      expect(options.lockMode).toBe(LockMode.PESSIMISTIC_WRITE)
      return entity === Document ? document : entity === DocumentContent ? content : null
    })
    mockFindWithDecryption.mockImplementation(async (
      _em: EntityManager,
      _entity: unknown,
      _where: unknown,
      options: { lockMode?: LockMode },
    ) => {
      order.push('read-links')
      expect(options.lockMode).toBe(LockMode.PESSIMISTIC_WRITE)
      return [link]
    })

    const input = redoInput()
    const after = {
      documentId,
      contentId,
      linkIds: [linkId],
      documentDeletedAt: null,
      contentDeletedAt: null,
      documentUpdatedAt: originalUpdatedAt,
      contentUpdatedAt: originalUpdatedAt,
      links: [{ id: linkId, deletedAt: null, updatedAt: originalUpdatedAt }],
    }

    await expect(instantiateDocumentCommand.undo!({
      input,
      ctx: makeContext(em),
      logEntry: {
        commandPayload: {
          __redoInput: input,
          undo: { before: null, after },
        },
      },
    })).rejects.toMatchObject({ status: 409 })

    expect(order[0]).toBe('begin')
    expect(order.indexOf('begin')).toBeLessThan(order.indexOf('read-document'))
    expect(order.indexOf('read-document')).toBeLessThan(order.indexOf('authorize'))
    expect(order.indexOf('authorize')).toBeLessThan(order.indexOf('read-content'))
    expect(order.indexOf('read-content')).toBeLessThan(order.indexOf('read-links'))
    expect(em.commit).not.toHaveBeenCalled()
    expect(em.rollback).toHaveBeenCalledTimes(1)
    expect(em.flush).not.toHaveBeenCalled()
    expect(document.deletedAt).toBeNull()
    expect(content.deletedAt).toBeNull()
    expect(link.deletedAt).toBeNull()
  })

  it('rejects undo after documents.create is revoked without mutating the aggregate', async () => {
    const document = { id: documentId, updatedAt: new Date(originalUpdatedAt), deletedAt: null }
    const content = {
      id: contentId,
      documentId,
      updatedAt: new Date(originalUpdatedAt),
      deletedAt: null,
    }
    const link = {
      id: linkId,
      documentId,
      updatedAt: new Date(originalUpdatedAt),
      deletedAt: null,
    }
    const em = {
      begin: jest.fn(async () => undefined),
      commit: jest.fn(async () => undefined),
      rollback: jest.fn(async () => undefined),
      flush: jest.fn(async () => undefined),
    } as unknown as EntityManager
    mockAssertDocumentCommandCanEdit.mockResolvedValueOnce(['documents.edit'])
    mockFindOneWithDecryption.mockImplementation(async (
      _em: EntityManager,
      entity: unknown,
    ) => entity === Document ? document : entity === DocumentContent ? content : null)
    mockFindWithDecryption.mockResolvedValue([link])

    const input = redoInput()
    await expect(instantiateDocumentCommand.undo!({
      input,
      ctx: makeContext(em),
      logEntry: {
        commandPayload: {
          __redoInput: input,
          undo: {
            before: null,
            after: {
              documentId,
              contentId,
              linkIds: [linkId],
              documentDeletedAt: null,
              contentDeletedAt: null,
              documentUpdatedAt: originalUpdatedAt,
              contentUpdatedAt: originalUpdatedAt,
              links: [{ id: linkId, deletedAt: null, updatedAt: originalUpdatedAt }],
            },
          },
        },
      },
    })).rejects.toMatchObject({ status: 403 })

    expect(mockAssertDocumentCommandCanEdit).toHaveBeenCalledTimes(1)
    expect(mockFindOneWithDecryption).toHaveBeenCalledTimes(1)
    expect(em.commit).not.toHaveBeenCalled()
    expect(em.rollback).toHaveBeenCalledTimes(1)
    expect(em.flush).not.toHaveBeenCalled()
    expect(document.deletedAt).toBeNull()
    expect(content.deletedAt).toBeNull()
    expect(link.deletedAt).toBeNull()
  })

  it('rejects undo after documents.delete is revoked without mutating the aggregate', async () => {
    const document = { id: documentId, updatedAt: new Date(originalUpdatedAt), deletedAt: null }
    const content = {
      id: contentId,
      documentId,
      updatedAt: new Date(originalUpdatedAt),
      deletedAt: null,
    }
    const link = {
      id: linkId,
      documentId,
      updatedAt: new Date(originalUpdatedAt),
      deletedAt: null,
    }
    const em = {
      begin: jest.fn(async () => undefined),
      commit: jest.fn(async () => undefined),
      rollback: jest.fn(async () => undefined),
      flush: jest.fn(async () => undefined),
    } as unknown as EntityManager
    mockAssertDocumentCommandCanEdit.mockResolvedValueOnce([
      'documents.create',
      'documents.edit',
      'catalog.products.view',
    ])
    mockFindOneWithDecryption.mockImplementation(async (
      _em: EntityManager,
      entity: unknown,
    ) => entity === Document ? document : entity === DocumentContent ? content : null)
    mockFindWithDecryption.mockResolvedValue([link])

    const input = redoInput()
    await expect(instantiateDocumentCommand.undo!({
      input,
      ctx: makeContext(em),
      logEntry: {
        commandPayload: {
          __redoInput: input,
          undo: {
            before: null,
            after: {
              documentId,
              contentId,
              linkIds: [linkId],
              documentDeletedAt: null,
              contentDeletedAt: null,
              documentUpdatedAt: originalUpdatedAt,
              contentUpdatedAt: originalUpdatedAt,
              links: [{ id: linkId, deletedAt: null, updatedAt: originalUpdatedAt }],
            },
          },
        },
      },
    })).rejects.toMatchObject({ status: 403 })

    expect(mockAssertDocumentCommandCanEdit).toHaveBeenCalledTimes(1)
    expect(mockFindOneWithDecryption).toHaveBeenCalledTimes(1)
    expect(em.commit).not.toHaveBeenCalled()
    expect(em.rollback).toHaveBeenCalledTimes(1)
    expect(em.flush).not.toHaveBeenCalled()
    expect(document.deletedAt).toBeNull()
    expect(content.deletedAt).toBeNull()
    expect(link.deletedAt).toBeNull()
  })

  it('rejects undo after the linked entity feature is revoked without mutating the aggregate', async () => {
    const document = { id: documentId, updatedAt: new Date(originalUpdatedAt), deletedAt: null }
    const content = {
      id: contentId,
      documentId,
      updatedAt: new Date(originalUpdatedAt),
      deletedAt: null,
    }
    const link = {
      id: linkId,
      documentId,
      updatedAt: new Date(originalUpdatedAt),
      deletedAt: null,
    }
    const em = {
      begin: jest.fn(async () => undefined),
      commit: jest.fn(async () => undefined),
      rollback: jest.fn(async () => undefined),
      flush: jest.fn(async () => undefined),
    } as unknown as EntityManager
    mockAssertDocumentCommandCanEdit.mockResolvedValueOnce([
      'documents.create',
      'documents.delete',
      'documents.edit',
    ])
    mockFindOneWithDecryption.mockImplementation(async (
      _em: EntityManager,
      entity: unknown,
    ) => entity === Document ? document : entity === DocumentContent ? content : null)
    mockFindWithDecryption.mockResolvedValue([link])

    const input = redoInput()
    await expect(instantiateDocumentCommand.undo!({
      input,
      ctx: makeContext(em),
      logEntry: {
        commandPayload: {
          __redoInput: input,
          undo: {
            before: null,
            after: {
              documentId,
              contentId,
              linkIds: [linkId],
              documentDeletedAt: null,
              contentDeletedAt: null,
              documentUpdatedAt: originalUpdatedAt,
              contentUpdatedAt: originalUpdatedAt,
              links: [{ id: linkId, deletedAt: null, updatedAt: originalUpdatedAt }],
            },
          },
        },
      },
    })).rejects.toMatchObject({ status: 403 })

    expect(em.commit).not.toHaveBeenCalled()
    expect(em.rollback).toHaveBeenCalledTimes(1)
    expect(em.flush).not.toHaveBeenCalled()
    expect(document.deletedAt).toBeNull()
    expect(content.deletedAt).toBeNull()
    expect(link.deletedAt).toBeNull()
  })

  it('rejects a relation added after instantiation instead of orphaning it', async () => {
    const document = { id: documentId, updatedAt: new Date(originalUpdatedAt), deletedAt: null }
    const content = {
      id: contentId,
      documentId,
      updatedAt: new Date(originalUpdatedAt),
      deletedAt: null,
    }
    const originalLink = {
      id: linkId,
      documentId,
      updatedAt: new Date(originalUpdatedAt),
      deletedAt: null,
    }
    const concurrentLink = {
      id: '99999999-9999-4999-8999-999999999999',
      documentId,
      updatedAt: new Date(concurrentUpdatedAt),
      deletedAt: null,
    }
    const em = {
      begin: jest.fn(async () => undefined),
      commit: jest.fn(async () => undefined),
      rollback: jest.fn(async () => undefined),
      flush: jest.fn(async () => undefined),
    } as unknown as EntityManager
    mockFindOneWithDecryption.mockImplementation(async (
      _em: EntityManager,
      entity: unknown,
    ) => entity === Document ? document : entity === DocumentContent ? content : null)
    mockFindWithDecryption.mockImplementation(async (
      _em: EntityManager,
      _entity: unknown,
      where: Record<string, unknown>,
    ) => {
      expect(where).toMatchObject({ documentId, tenantId, organizationId })
      expect(where).not.toHaveProperty('id')
      return [originalLink, concurrentLink]
    })

    const input = redoInput()
    await expect(instantiateDocumentCommand.undo!({
      input,
      ctx: makeContext(em),
      logEntry: {
        commandPayload: {
          __redoInput: input,
          undo: {
            before: null,
            after: {
              documentId,
              contentId,
              linkIds: [linkId],
              documentDeletedAt: null,
              contentDeletedAt: null,
              documentUpdatedAt: originalUpdatedAt,
              contentUpdatedAt: originalUpdatedAt,
              links: [{ id: linkId, deletedAt: null, updatedAt: originalUpdatedAt }],
            },
          },
        },
      },
    })).rejects.toMatchObject({ status: 409 })

    expect(em.commit).not.toHaveBeenCalled()
    expect(em.rollback).toHaveBeenCalledTimes(1)
    expect(document.deletedAt).toBeNull()
    expect(content.deletedAt).toBeNull()
    expect(concurrentLink.deletedAt).toBeNull()
  })

  it.each([
    ['share', DocumentShare],
    ['comment', DocumentComment],
    ['version', DocumentVersion],
    ['attachment', DocumentAttachment],
  ])('rejects a post-create %s before deleting the aggregate', async (_label, dependentEntity) => {
    const document = { id: documentId, updatedAt: new Date(originalUpdatedAt), deletedAt: null }
    const content = {
      id: contentId,
      documentId,
      updatedAt: new Date(originalUpdatedAt),
      deletedAt: null,
    }
    const originalLink = {
      id: linkId,
      documentId,
      updatedAt: new Date(originalUpdatedAt),
      deletedAt: null,
    }
    const em = {
      begin: jest.fn(async () => undefined),
      commit: jest.fn(async () => undefined),
      rollback: jest.fn(async () => undefined),
      flush: jest.fn(async () => undefined),
    } as unknown as EntityManager
    mockFindOneWithDecryption.mockImplementation(async (
      _em: EntityManager,
      entity: unknown,
    ) => entity === Document ? document : entity === DocumentContent ? content : null)
    let linkRead = 0
    mockFindWithDecryption.mockImplementation(async (
      _em: EntityManager,
      entity: unknown,
    ) => {
      if (entity === DocumentEntityLink) {
        linkRead += 1
        return [originalLink]
      }
      return entity === dependentEntity ? [{ id: 'post-create-dependent' }] : []
    })

    const input = redoInput()
    await expect(instantiateDocumentCommand.undo!({
      input,
      ctx: makeContext(em),
      logEntry: {
        commandPayload: {
          __redoInput: input,
          undo: {
            before: null,
            after: {
              documentId,
              contentId,
              linkIds: [linkId],
              documentDeletedAt: null,
              contentDeletedAt: null,
              documentUpdatedAt: originalUpdatedAt,
              contentUpdatedAt: originalUpdatedAt,
              links: [{ id: linkId, deletedAt: null, updatedAt: originalUpdatedAt }],
            },
          },
        },
      },
    })).rejects.toMatchObject({ status: 409 })

    expect(linkRead).toBe(2)
    expect(em.commit).not.toHaveBeenCalled()
    expect(em.rollback).toHaveBeenCalledTimes(1)
    expect(document.deletedAt).toBeNull()
    expect(content.deletedAt).toBeNull()
    expect(originalLink.deletedAt).toBeNull()
  })
})
