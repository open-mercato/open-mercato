import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { Document, DocumentEntityLink } from '../data/entities'
import { DOCUMENTS_MAX_ENTITY_LINKS_PER_DOCUMENT } from '../lib/resourceLimits'

const mockFindOneWithDecryption = jest.fn()
const mockAssertDocumentCommandCanEdit = jest.fn()
const mockEnforceCommandOptimisticLock = jest.fn()
const mockVerifyEntityRegistrySelection = jest.fn()
const mockIsDocumentEntityRegistryModuleEnabled = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/crud/optimistic-lock-command')
  return {
    ...actual,
    enforceCommandOptimisticLock: (...args: unknown[]) => mockEnforceCommandOptimisticLock(...args),
  }
})

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

jest.mock('../lib/entityRegistry.server', () => ({
  verifyEntityRegistrySelection: (...args: unknown[]) => mockVerifyEntityRegistrySelection(...args),
}))

jest.mock('../lib/entityRegistryAvailability.server', () => ({
  isDocumentEntityRegistryModuleEnabled: (...args: unknown[]) => (
    mockIsDocumentEntityRegistryModuleEnabled(...args)
  ),
}))

jest.mock('../commands/shared', () => {
  const actual = jest.requireActual('../commands/shared')
  return {
    ...actual,
    assertDocumentCommandCanEdit: (...args: unknown[]) => mockAssertDocumentCommandCanEdit(...args),
  }
})

import {
  createLinkCommand,
  deleteLinkCommand,
  type LinkCreateCommandInput,
  type LinkDeleteCommandInput,
} from '../commands/links'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const actorUserId = '33333333-3333-4333-8333-333333333333'
const documentId = '44444444-4444-4444-8444-444444444444'
const linkId = '55555555-5555-4555-8555-555555555555'
const productId = '66666666-6666-4666-8666-666666666666'
const updatedAt = '2026-07-10T12:00:00.000Z'

function verifiedProduct(label = 'Atlas Runner') {
  return {
    id: productId,
    label,
    href: `/backend/catalog/products/${productId}`,
    values: {},
  }
}

function linkInput(): LinkCreateCommandInput {
  return {
    tenantId,
    organizationId,
    documentId,
    linkId,
    link: {
      entityType: 'product',
      entityId: productId,
      label: 'Caller supplied product',
      href: `/backend/catalog/products/${productId}?caller=supplied`,
      source: 'related-panel',
    },
  }
}

function deleteInput(): LinkDeleteCommandInput {
  return { tenantId, organizationId, documentId, linkId }
}

function makeDocument(): Document {
  return Object.assign(new Document(), {
    id: documentId,
    tenantId,
    organizationId,
    title: 'Review',
    ownerUserId: actorUserId,
    createdByUserId: actorUserId,
    updatedAt: new Date(updatedAt),
    deletedAt: null,
  })
}

function makeLink(deletedAt: Date | null = null): DocumentEntityLink {
  return Object.assign(new DocumentEntityLink(), {
    id: linkId,
    tenantId,
    organizationId,
    documentId,
    productId,
    labelSnapshot: 'Atlas Runner',
    hrefSnapshot: `/backend/catalog/products/${productId}`,
    source: 'related-panel',
    createdByUserId: actorUserId,
    createdAt: new Date(updatedAt),
    updatedAt: new Date(updatedAt),
    deletedAt,
  })
}

function buildHarness() {
  const order: string[] = []
  const dataEngine = { markOrmEntityChange: jest.fn() }
  const rbacService = {
    invalidateUserCache: jest.fn(async () => undefined),
    loadAcl: jest.fn(async () => ({
      isSuperAdmin: false,
      features: ['documents.edit', 'catalog.products.view'],
      organizations: null,
    })),
  }
  const em = {
    fork: jest.fn(() => em),
    begin: jest.fn(async () => { order.push('begin') }),
    flush: jest.fn(async () => { order.push('flush') }),
    commit: jest.fn(async () => { order.push('commit') }),
    rollback: jest.fn(async () => { order.push('rollback') }),
    create: jest.fn((entity: unknown, data: Record<string, unknown>) => {
      if (entity !== DocumentEntityLink) throw new Error('Unexpected entity')
      return Object.assign(new DocumentEntityLink(), data)
    }),
    persist: jest.fn(),
    count: jest.fn(async () => 0),
  } as unknown as EntityManager
  const ctx: CommandRuntimeContext = {
    container: {
      resolve: (token: string) => {
        if (token === 'em') return em
        if (token === 'dataEngine') return dataEngine
        if (token === 'rbacService') return rbacService
        throw new Error(`Unexpected dependency: ${token}`)
      },
    } as CommandRuntimeContext['container'],
    auth: {
      sub: actorUserId,
      userId: actorUserId,
      tenantId,
      orgId: organizationId,
      features: ['documents.edit', 'catalog.products.view'],
    } as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
    request: new Request('http://localhost/api/documents/link'),
  }
  mockAssertDocumentCommandCanEdit.mockImplementation(async () => {
    order.push('authorize')
    return ['documents.edit', 'catalog.products.view']
  })
  return { ctx, em, order, dataEngine, rbacService }
}

describe('document link command transaction snapshots', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers({ now: new Date('2020-01-01T00:00:00.000Z') })
    mockIsDocumentEntityRegistryModuleEnabled.mockReturnValue(true)
    mockVerifyEntityRegistrySelection.mockResolvedValue(verifiedProduct())
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('captures create before/after under the parent lock and buildLog ignores later snapshots', async () => {
    const harness = buildHarness()
    mockVerifyEntityRegistrySelection.mockImplementation(async () => {
      harness.order.push('verify-target')
      return verifiedProduct()
    })
    mockFindOneWithDecryption.mockImplementation(async (
      _em: EntityManager,
      entity: unknown,
    ) => {
      if (entity === Document) {
        harness.order.push('lock-document')
        return makeDocument()
      }
      harness.order.push('lock-link')
      return null
    })

    const result = await createLinkCommand.execute(linkInput(), harness.ctx)
    expect(result.before).toMatchObject({ id: linkId, existed: false, updatedAt: null })
    expect(result.after).toMatchObject({ id: linkId, existed: true, deletedAt: null })
    expect(harness.order.slice(0, 6)).toEqual([
      'verify-target',
      'begin',
      'lock-document',
      'authorize',
      'verify-target',
      'lock-link',
    ])
    expect(mockVerifyEntityRegistrySelection).toHaveBeenCalledTimes(2)
    expect(mockVerifyEntityRegistrySelection).toHaveBeenNthCalledWith(
      1,
      harness.ctx.request,
      linkInput().link,
    )
    expect(mockVerifyEntityRegistrySelection).toHaveBeenNthCalledWith(
      2,
      harness.ctx.request,
      linkInput().link,
    )
    expect(harness.em.create).toHaveBeenCalledWith(
      DocumentEntityLink,
      expect.objectContaining({
        labelSnapshot: 'Atlas Runner',
        hrefSnapshot: `/backend/catalog/products/${productId}`,
      }),
    )

    const metadata = await createLinkCommand.buildLog!({
      input: linkInput(),
      result,
      ctx: harness.ctx,
      snapshots: {
        before: { id: 'raced-before' },
        after: { id: 'raced-after' },
      },
    })
    expect(metadata?.snapshotBefore).toEqual(result.before)
    expect(metadata?.snapshotAfter).toEqual(result.after)
  })

  it('rejects a new active link at the aggregate cap before persistence', async () => {
    const harness = buildHarness()
    ;(harness.em.count as jest.Mock).mockResolvedValue(DOCUMENTS_MAX_ENTITY_LINKS_PER_DOCUMENT)
    mockFindOneWithDecryption.mockImplementation(async (
      _em: EntityManager,
      entity: unknown,
    ) => entity === Document ? makeDocument() : null)

    await expect(createLinkCommand.execute(linkInput(), harness.ctx)).rejects.toMatchObject({
      status: 413,
      body: { error: 'documents.links.limitExceeded' },
    })
    expect(harness.em.count).toHaveBeenCalledWith(DocumentEntityLink, {
      documentId,
      tenantId,
      organizationId,
      deletedAt: null,
    })
    expect(harness.em.persist).not.toHaveBeenCalled()
  })

  it('allows only the first serialized create when two decisions start with 99 active links', async () => {
    const harness = buildHarness()
    let activeCount = DOCUMENTS_MAX_ENTITY_LINKS_PER_DOCUMENT - 1
    ;(harness.em.count as jest.Mock).mockImplementation(async () => activeCount)
    ;(harness.em.persist as jest.Mock).mockImplementation(() => {
      activeCount += 1
    })
    mockFindOneWithDecryption.mockImplementation(async (
      _em: EntityManager,
      entity: unknown,
    ) => entity === Document ? makeDocument() : null)

    await expect(createLinkCommand.execute(linkInput(), harness.ctx)).resolves.toMatchObject({
      created: true,
    })
    await expect(createLinkCommand.execute(linkInput(), harness.ctx)).rejects.toMatchObject({
      status: 413,
      body: { error: 'documents.links.limitExceeded' },
    })

    expect(harness.em.count).toHaveBeenCalledTimes(2)
    expect(harness.em.persist).toHaveBeenCalledTimes(1)
  })

  it('rejects redo-style resurrection of a deleted link when the slot was refilled', async () => {
    const harness = buildHarness()
    const deleted = makeLink(new Date('2026-07-10T12:00:01.000Z'))
    ;(harness.em.count as jest.Mock).mockResolvedValue(DOCUMENTS_MAX_ENTITY_LINKS_PER_DOCUMENT)
    mockFindOneWithDecryption.mockImplementation(async (
      _em: EntityManager,
      entity: unknown,
    ) => entity === Document ? makeDocument() : deleted)

    await expect(createLinkCommand.execute(linkInput(), harness.ctx)).rejects.toMatchObject({
      status: 413,
      body: { error: 'documents.links.limitExceeded' },
    })

    expect(deleted.deletedAt).not.toBeNull()
    expect(harness.em.persist).not.toHaveBeenCalled()
  })

  it('rejects stale superadmin grants before target lookup when the peer module is disabled', async () => {
    const harness = buildHarness()
    mockAssertDocumentCommandCanEdit.mockResolvedValue(['*'])
    mockIsDocumentEntityRegistryModuleEnabled.mockReturnValue(false)

    await expect(createLinkCommand.execute(linkInput(), harness.ctx)).rejects.toMatchObject({
      status: 403,
      body: { error: 'documents.links.targetRestricted' },
    })

    expect(mockVerifyEntityRegistrySelection).not.toHaveBeenCalled()
    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
    expect(harness.em.begin).not.toHaveBeenCalled()
  })

  it('rejects stale request grants before target lookup when the live peer feature is revoked', async () => {
    const harness = buildHarness()
    harness.rbacService.loadAcl.mockResolvedValue({
      isSuperAdmin: false,
      features: ['documents.edit'],
      organizations: null,
    })

    await expect(createLinkCommand.execute(linkInput(), harness.ctx)).rejects.toMatchObject({
      status: 403,
    })

    expect(mockVerifyEntityRegistrySelection).not.toHaveBeenCalled()
    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
    expect(harness.em.begin).not.toHaveBeenCalled()
  })

  it('rechecks peer module availability after locking the document aggregate', async () => {
    const harness = buildHarness()
    mockIsDocumentEntityRegistryModuleEnabled
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false)
    mockFindOneWithDecryption.mockImplementation(async (
      _em: EntityManager,
      entity: unknown,
    ) => entity === Document ? makeDocument() : null)

    await expect(createLinkCommand.execute(linkInput(), harness.ctx)).rejects.toMatchObject({
      status: 403,
      body: { error: 'documents.links.targetRestricted' },
    })

    expect(mockVerifyEntityRegistrySelection).toHaveBeenCalledTimes(1)
    expect(harness.em.rollback).toHaveBeenCalledTimes(1)
    expect(harness.em.create).not.toHaveBeenCalled()
  })

  it('rolls back when peer-record access is revoked while waiting for the document lock', async () => {
    const harness = buildHarness()
    mockVerifyEntityRegistrySelection
      .mockImplementationOnce(async () => {
        harness.order.push('verify-target-before-lock')
        return verifiedProduct()
      })
      .mockImplementationOnce(async () => {
        harness.order.push('verify-target-after-lock')
        throw new CrudHttpError(403, { error: 'documents.links.targetRestricted' })
      })
    mockFindOneWithDecryption.mockImplementation(async (
      _em: EntityManager,
      entity: unknown,
    ) => {
      if (entity !== Document) throw new Error('Link lookup must not run after target revocation')
      harness.order.push('lock-document')
      return makeDocument()
    })

    await expect(createLinkCommand.execute(linkInput(), harness.ctx)).rejects.toMatchObject({
      status: 403,
    })

    expect(harness.order).toEqual([
      'verify-target-before-lock',
      'begin',
      'lock-document',
      'authorize',
      'verify-target-after-lock',
      'rollback',
    ])
    expect(mockVerifyEntityRegistrySelection).toHaveBeenCalledTimes(2)
    expect(harness.em.create).not.toHaveBeenCalled()
    expect(harness.em.persist).not.toHaveBeenCalled()
    expect(harness.em.commit).not.toHaveBeenCalled()
    expect(harness.dataEngine.markOrmEntityChange).not.toHaveBeenCalled()
  })

  it('rolls back when the peer record is deleted while waiting for the document lock', async () => {
    const harness = buildHarness()
    mockVerifyEntityRegistrySelection
      .mockResolvedValueOnce(verifiedProduct())
      .mockRejectedValueOnce(new CrudHttpError(503, { error: 'documents.links.targetUnavailable' }))
    mockFindOneWithDecryption.mockImplementation(async (
      _em: EntityManager,
      entity: unknown,
    ) => {
      if (entity !== Document) throw new Error('Link lookup must not run after target deletion')
      harness.order.push('lock-document')
      return makeDocument()
    })

    await expect(createLinkCommand.execute(linkInput(), harness.ctx)).rejects.toMatchObject({
      status: 503,
    })

    expect(harness.order).toEqual(['begin', 'lock-document', 'authorize', 'rollback'])
    expect(mockVerifyEntityRegistrySelection).toHaveBeenCalledTimes(2)
    expect(harness.em.create).not.toHaveBeenCalled()
    expect(harness.em.persist).not.toHaveBeenCalled()
    expect(harness.em.commit).not.toHaveBeenCalled()
    expect(harness.dataEngine.markOrmEntityChange).not.toHaveBeenCalled()
  })

  it('rolls back when the canonical peer label changes while waiting for the document lock', async () => {
    const harness = buildHarness()
    mockVerifyEntityRegistrySelection
      .mockResolvedValueOnce(verifiedProduct())
      .mockResolvedValueOnce(verifiedProduct('Atlas Runner 2'))
    mockFindOneWithDecryption.mockImplementation(async (
      _em: EntityManager,
      entity: unknown,
    ) => {
      if (entity !== Document) throw new Error('Link lookup must not run after target change')
      harness.order.push('lock-document')
      return makeDocument()
    })

    await expect(createLinkCommand.execute(linkInput(), harness.ctx)).rejects.toMatchObject({
      status: 409,
      body: { error: 'Record changed by another user' },
    })

    expect(harness.order).toEqual(['begin', 'lock-document', 'authorize', 'rollback'])
    expect(mockVerifyEntityRegistrySelection).toHaveBeenCalledTimes(2)
    expect(harness.em.create).not.toHaveBeenCalled()
    expect(harness.em.persist).not.toHaveBeenCalled()
    expect(harness.em.commit).not.toHaveBeenCalled()
    expect(harness.dataEngine.markOrmEntityChange).not.toHaveBeenCalled()
  })

  it('captures delete snapshots in the locked transaction', async () => {
    const harness = buildHarness()
    const link = makeLink()
    mockFindOneWithDecryption.mockImplementation(async (
      _em: EntityManager,
      entity: unknown,
    ) => entity === Document ? makeDocument() : link)

    const result = await deleteLinkCommand.execute(deleteInput(), harness.ctx)
    expect(result.before).toMatchObject({ existed: true, deletedAt: null, updatedAt })
    expect(result.after.existed).toBe(true)
    expect(result.after.deletedAt).not.toBeNull()
    expect(Date.parse(result.updatedAt)).toBeGreaterThan(Date.parse(updatedAt))
    expect(mockEnforceCommandOptimisticLock).toHaveBeenCalledTimes(1)

    await deleteLinkCommand.undo!({
      input: deleteInput(),
      ctx: harness.ctx,
      logEntry: {
        commandPayload: {
          __redoInput: deleteInput(),
          undo: { before: result.before, after: result.after },
        },
      },
    })
    const undoVersion = link.updatedAt.toISOString()
    expect(Date.parse(undoVersion)).toBeGreaterThan(Date.parse(result.updatedAt))

    const redone = await deleteLinkCommand.execute(deleteInput(), harness.ctx)
    expect(Date.parse(redone.updatedAt)).toBeGreaterThan(Date.parse(undoVersion))
  })

  it('allows an editor to remove a legacy link when its peer module is disabled', async () => {
    const harness = buildHarness()
    const link = makeLink()
    mockAssertDocumentCommandCanEdit.mockResolvedValue(['documents.edit'])
    mockIsDocumentEntityRegistryModuleEnabled.mockReturnValue(false)
    mockFindOneWithDecryption.mockImplementation(async (
      _em: EntityManager,
      entity: unknown,
    ) => entity === Document ? makeDocument() : link)

    await expect(deleteLinkCommand.execute(deleteInput(), harness.ctx)).resolves.toMatchObject({
      id: linkId,
    })

    expect(link.deletedAt).not.toBeNull()
    expect(mockIsDocumentEntityRegistryModuleEnabled).not.toHaveBeenCalled()
    expect(mockVerifyEntityRegistrySelection).not.toHaveBeenCalled()
  })

  it('rejects create undo when the current peer feature was revoked', async () => {
    const harness = buildHarness()
    const link = makeLink()
    mockAssertDocumentCommandCanEdit.mockResolvedValue(['documents.edit'])
    mockFindOneWithDecryption.mockImplementation(async (
      _em: EntityManager,
      entity: unknown,
    ) => entity === Document ? makeDocument() : link)

    await expect(createLinkCommand.undo!({
      input: {},
      ctx: harness.ctx,
      logEntry: {
        commandPayload: {
          __redoInput: linkInput(),
          undo: {
            before: { id: linkId, existed: false, deletedAt: null, updatedAt: null },
            after: { id: linkId, existed: true, deletedAt: null, updatedAt },
            createdByCommand: true,
          },
        },
      },
    })).rejects.toMatchObject({ status: 403 })

    expect(link.deletedAt).toBeNull()
    expect(harness.em.rollback).toHaveBeenCalledTimes(1)
  })

  it('fails closed when undo would resurrect a link to a disabled peer module', async () => {
    const harness = buildHarness()
    const deletedAt = new Date('2026-07-10T12:00:01.000Z')
    const link = makeLink(deletedAt)
    link.updatedAt = deletedAt
    mockAssertDocumentCommandCanEdit.mockResolvedValue(['*'])
    mockIsDocumentEntityRegistryModuleEnabled.mockReturnValue(false)
    mockFindOneWithDecryption.mockImplementation(async (
      _em: EntityManager,
      entity: unknown,
    ) => entity === Document ? makeDocument() : link)

    await expect(deleteLinkCommand.undo!({
      input: {},
      ctx: harness.ctx,
      logEntry: {
        commandPayload: {
          __redoInput: deleteInput(),
          undo: {
            before: { id: linkId, existed: true, deletedAt: null, updatedAt },
            after: {
              id: linkId,
              existed: true,
              deletedAt: deletedAt.toISOString(),
              updatedAt: deletedAt.toISOString(),
            },
          },
        },
      },
    })).rejects.toMatchObject({ status: 403 })

    expect(link.deletedAt).toEqual(deletedAt)
    expect(mockVerifyEntityRegistrySelection).not.toHaveBeenCalled()
    expect(harness.em.rollback).toHaveBeenCalledTimes(1)
  })

  it('rejects delete undo when another link already refilled the aggregate slot', async () => {
    const harness = buildHarness()
    const deletedAt = new Date('2026-07-10T12:00:01.000Z')
    const link = makeLink(deletedAt)
    link.updatedAt = deletedAt
    ;(harness.em.count as jest.Mock).mockResolvedValue(DOCUMENTS_MAX_ENTITY_LINKS_PER_DOCUMENT)
    mockFindOneWithDecryption.mockImplementation(async (
      _em: EntityManager,
      entity: unknown,
    ) => entity === Document ? makeDocument() : link)

    await expect(deleteLinkCommand.undo!({
      input: {},
      ctx: harness.ctx,
      logEntry: {
        commandPayload: {
          __redoInput: deleteInput(),
          undo: {
            before: { id: linkId, existed: true, deletedAt: null, updatedAt },
            after: {
              id: linkId,
              existed: true,
              deletedAt: deletedAt.toISOString(),
              updatedAt: deletedAt.toISOString(),
            },
          },
        },
      },
    })).rejects.toMatchObject({
      status: 413,
      body: { error: 'documents.links.limitExceeded' },
    })

    expect(link.deletedAt).toEqual(deletedAt)
    expect(harness.em.rollback).toHaveBeenCalledTimes(1)
  })

  it('rejects delete undo when the locked row was physically removed', async () => {
    const harness = buildHarness()
    mockFindOneWithDecryption.mockImplementation(async (
      _em: EntityManager,
      entity: unknown,
    ) => {
      if (entity === Document) {
        harness.order.push('lock-document')
        return makeDocument()
      }
      return null
    })
    const afterUpdatedAt = '2026-07-10T12:00:01.000Z'

    await expect(deleteLinkCommand.undo!({
      input: {},
      ctx: harness.ctx,
      logEntry: {
        commandPayload: {
          __redoInput: deleteInput(),
          undo: {
            before: { id: linkId, existed: true, deletedAt: null, updatedAt },
            after: {
              id: linkId,
              existed: true,
              deletedAt: afterUpdatedAt,
              updatedAt: afterUpdatedAt,
            },
          },
        },
      },
    })).rejects.toMatchObject({ status: 409 })

    expect(harness.order.slice(0, 4)).toEqual(['begin', 'lock-document', 'authorize', 'rollback'])
    expect(harness.em.commit).not.toHaveBeenCalled()
    expect(harness.dataEngine.markOrmEntityChange).not.toHaveBeenCalled()
  })
})
