import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  Document,
  DocumentContent,
  DocumentEntityLink,
  DocumentFolder,
  DocumentTemplate,
} from '../data/entities'

const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockMutateDocumentContentState = jest.fn()
const mockPrepareTemplateRender = jest.fn()
const mockIsDocumentEntityRegistryModuleEnabled = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

jest.mock('../lib/contentService', () => ({
  advanceDocumentCollaborationGeneration: (content: { collaborationGeneration?: number }) => {
    content.collaborationGeneration = (content.collaborationGeneration ?? 1) + 1
    return content.collaborationGeneration
  },
  mutateDocumentContentState: (...args: unknown[]) => mockMutateDocumentContentState(...args),
}))

jest.mock('../lib/templateInstantiation', () => ({
  dedupeTemplateLinkSlots: (slots: unknown[]) => slots,
  prepareTemplateRender: (...args: unknown[]) => mockPrepareTemplateRender(...args),
}))

jest.mock('../lib/entityRegistryAvailability.server', () => ({
  isDocumentEntityRegistryModuleEnabled: (...args: unknown[]) => (
    mockIsDocumentEntityRegistryModuleEnabled(...args)
  ),
}))

jest.mock('../commands/side-effects', () => ({
  bufferDocumentMutationSideEffects: jest.fn(async () => undefined),
  bufferLinkMutationSideEffects: jest.fn(async () => undefined),
}))

import {
  instantiateDocumentCommand,
  type InstantiateDocumentCommandInput,
} from '../commands/documents'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const actorUserId = '33333333-3333-4333-8333-333333333333'
const documentId = '44444444-4444-4444-8444-444444444444'
const contentId = '55555555-5555-4555-8555-555555555555'
const templateId = '66666666-6666-4666-8666-666666666666'
const folderId = '77777777-7777-4777-8777-777777777777'
const linkId = '88888888-8888-4888-8888-888888888888'
const productId = '99999999-9999-4999-8999-999999999999'
const now = new Date('2026-07-10T12:00:00.000Z')

function input(): InstantiateDocumentCommandInput {
  return {
    tenantId,
    organizationId,
    documentId,
    contentId,
    templateId,
    linkIds: [],
    createdByUserId: actorUserId,
    title: 'Quarterly review',
    folderId,
    locale: 'en',
    effectiveDate: now.toISOString(),
    templateUpdatedAt: now.toISOString(),
    slots: [],
    previewDigest: `sha256:${'a'.repeat(64)}`,
  }
}

function inputWithProduct(): InstantiateDocumentCommandInput {
  return {
    ...input(),
    linkIds: [linkId],
    slots: [{
      slot: 'product',
      entityType: 'product',
      entityId: productId,
      label: 'Atlas Runner',
      href: `/backend/catalog/products/${productId}`,
      values: {},
    }],
  }
}

function buildHarness() {
  const order: string[] = []
  const dataEngine = { markOrmEntityChange: jest.fn() }
  const rbacService = {
    invalidateUserCache: jest.fn(async () => undefined),
    loadAcl: jest.fn(async () => ({
      isSuperAdmin: false,
      features: ['documents.create', 'documents.edit'],
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
      order.push(entity === Document ? 'create-document' : 'create-content')
      if (entity === Document) return Object.assign(new Document(), data, { createdAt: now, updatedAt: now })
      if (entity === DocumentContent) {
        return Object.assign(new DocumentContent(), data, { createdAt: now, updatedAt: now })
      }
      if (entity === DocumentEntityLink) {
        return Object.assign(new DocumentEntityLink(), data, { createdAt: now, updatedAt: now })
      }
      throw new Error('Unexpected entity')
    }),
    persist: jest.fn(() => { order.push('persist') }),
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
      features: ['documents.create', 'documents.edit'],
    } as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
    request: new Request('http://localhost/api/documents/instantiate', { method: 'POST' }),
  }
  return { ctx, em, order, dataEngine, rbacService }
}

function productRender(label: string) {
  return {
    verifiedSlots: [{
      ...inputWithProduct().slots[0],
      label,
      href: `/backend/catalog/products/${productId}`,
      values: { title: label, sku: 'SKU-1' },
    }],
    content: {
      yjsState: Buffer.from(label),
      html: `<p>${label}</p>`,
      text: label,
    },
  }
}

function configureProductInstantiationReads(harness: ReturnType<typeof buildHarness>) {
  const template = Object.assign(new DocumentTemplate(), {
    id: templateId,
    tenantId,
    organizationId,
    name: 'Product review',
    bodyHtml: '<p>{{product.title}}</p>',
    contextSlots: [{ slot: 'product', entityType: 'product', required: true }],
    createdByUserId: actorUserId,
    isActive: true,
    updatedAt: now,
    deletedAt: null,
  })
  const folder = Object.assign(new DocumentFolder(), {
    id: folderId,
    tenantId,
    organizationId,
    name: 'Reviews',
    ownerUserId: actorUserId,
    updatedAt: now,
    deletedAt: null,
  })
  mockFindOneWithDecryption.mockImplementation(async (
    _em: EntityManager,
    entity: unknown,
    _where: unknown,
    options?: { lockMode?: LockMode },
  ) => {
    if (entity === DocumentTemplate) {
      if (options?.lockMode === LockMode.PESSIMISTIC_READ) harness.order.push('lock-template')
      return template
    }
    if (entity === DocumentFolder) return folder
    if (entity === Document) {
      harness.order.push('lock-document-slot')
      return null
    }
    if (entity === DocumentContent) return null
    throw new Error('Unexpected read')
  })
  mockFindWithDecryption.mockResolvedValue([])
}

describe('document instantiation transaction snapshots', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockIsDocumentEntityRegistryModuleEnabled.mockReturnValue(true)
  })

  it('relocks the folder, flushes the parent first, and logs only the locked aggregate snapshot', async () => {
    const harness = buildHarness()
    const template = Object.assign(new DocumentTemplate(), {
      id: templateId,
      tenantId,
      organizationId,
      name: 'Review',
      bodyHtml: '<p>Review</p>',
      createdByUserId: actorUserId,
      isActive: true,
      updatedAt: now,
      deletedAt: null,
    })
    const folder = Object.assign(new DocumentFolder(), {
      id: folderId,
      tenantId,
      organizationId,
      name: 'Reviews',
      ownerUserId: actorUserId,
      updatedAt: now,
      deletedAt: null,
    })
    mockFindOneWithDecryption.mockImplementation(async (
      _em: EntityManager,
      entity: unknown,
      _where: unknown,
      options?: { lockMode?: LockMode },
    ) => {
      if (entity === DocumentTemplate) {
        harness.order.push(options?.lockMode === LockMode.PESSIMISTIC_READ ? 'lock-template' : 'read-template')
        return template
      }
      if (entity === DocumentFolder) {
        harness.order.push(options?.lockMode === LockMode.PESSIMISTIC_READ ? 'lock-folder' : 'read-folder')
        return folder
      }
      if (entity === Document) {
        harness.order.push('lock-document-slot')
        return null
      }
      if (entity === DocumentContent) return null
      throw new Error('Unexpected read')
    })
    mockFindWithDecryption.mockResolvedValue([])
    mockPrepareTemplateRender.mockResolvedValue({
      verifiedSlots: [],
      content: { yjsState: Buffer.from('snapshot'), html: '<p>Review</p>', text: 'Review' },
    })
    mockMutateDocumentContentState.mockImplementation(async (
      em: EntityManager,
      _documentId: string,
      scope: { tenantId: string; organizationId: string },
      state: { yjsState: Buffer; contentHtml: string; contentText: string },
      options: { id: string },
    ) => {
      harness.order.push('mutate-content')
      const content = (em as unknown as { create: Function }).create(DocumentContent, {
        id: options.id,
        ...scope,
        documentId,
        ...state,
        deletedAt: null,
      }) as DocumentContent
      ;(em as unknown as { persist: (value: unknown) => void }).persist(content)
      return content
    })

    const result = await instantiateDocumentCommand.execute(input(), harness.ctx)

    expect(result.before.documentUpdatedAt).toBeNull()
    expect(result.after.documentUpdatedAt).toBe(now.toISOString())
    expect(result.after.links).toEqual([])
    expect(harness.order.indexOf('begin')).toBeLessThan(harness.order.indexOf('lock-template'))
    expect(harness.order.indexOf('lock-template')).toBeLessThan(harness.order.indexOf('lock-document-slot'))
    expect(harness.order.indexOf('begin')).toBeLessThan(harness.order.indexOf('lock-folder'))
    expect(harness.order.indexOf('create-document')).toBeLessThan(harness.order.indexOf('mutate-content'))
    const firstFlush = harness.order.indexOf('flush')
    expect(firstFlush).toBeGreaterThan(harness.order.indexOf('create-document'))
    expect(firstFlush).toBeLessThan(harness.order.indexOf('mutate-content'))

    const metadata = await instantiateDocumentCommand.buildLog!({
      input: input(),
      result,
      ctx: harness.ctx,
      snapshots: {
        after: {
          ...result.after,
          links: [{
            id: '88888888-8888-4888-8888-888888888888',
            deletedAt: null,
            updatedAt: now.toISOString(),
          }],
        },
      },
    })
    expect(metadata?.snapshotAfter).toEqual(result.after)
    expect((metadata?.snapshotAfter as { links: unknown[] }).links).toEqual([])
  })

  it('persists only authoritative registry snapshots returned by template preparation', async () => {
    const harness = buildHarness()
    harness.rbacService.loadAcl.mockResolvedValue({
      isSuperAdmin: false,
      features: ['documents.create', 'documents.edit', 'catalog.products.view'],
      organizations: null,
    })
    const template = Object.assign(new DocumentTemplate(), {
      id: templateId,
      tenantId,
      organizationId,
      name: 'Product review',
      bodyHtml: '<p>Review</p>',
      createdByUserId: actorUserId,
      isActive: true,
      updatedAt: now,
      deletedAt: null,
    })
    const folder = Object.assign(new DocumentFolder(), {
      id: folderId,
      tenantId,
      organizationId,
      name: 'Reviews',
      ownerUserId: actorUserId,
      updatedAt: now,
      deletedAt: null,
    })
    mockFindOneWithDecryption.mockImplementation(async (
      _em: EntityManager,
      entity: unknown,
    ) => {
      if (entity === DocumentTemplate) return template
      if (entity === DocumentFolder) return folder
      if (entity === Document || entity === DocumentContent) return null
      throw new Error('Unexpected read')
    })
    mockFindWithDecryption.mockResolvedValue([])
    mockPrepareTemplateRender.mockResolvedValueOnce(productRender('Authoritative product'))
    mockMutateDocumentContentState.mockImplementation(async (
      em: EntityManager,
      _documentId: string,
      scope: { tenantId: string; organizationId: string },
      state: { yjsState: Buffer; contentHtml: string; contentText: string },
      options: { id: string },
    ) => Object.assign(new DocumentContent(), {
      id: options.id,
      ...scope,
      documentId,
      ...state,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }))

    const submitted = inputWithProduct()
    submitted.slots[0]!.label = 'Caller controlled product'
    const result = await instantiateDocumentCommand.execute(submitted, harness.ctx)

    expect(result.links).toEqual([{
      id: linkId,
      entityType: 'product',
      label: 'Authoritative product',
      href: `/backend/catalog/products/${productId}`,
    }])
    const linkCreate = (harness.em.create as jest.Mock).mock.calls.find(
      ([entity]: [unknown]) => entity === DocumentEntityLink,
    )
    expect(linkCreate?.[1]).toMatchObject({
      labelSnapshot: 'Authoritative product',
      hrefSnapshot: `/backend/catalog/products/${productId}`,
    })
    expect(mockPrepareTemplateRender).toHaveBeenCalledTimes(1)
    expect(mockMutateDocumentContentState).toHaveBeenCalledWith(
      harness.em,
      documentId,
      { tenantId, organizationId },
      {
        yjsState: Buffer.from('Authoritative product'),
        contentHtml: '<p>Authoritative product</p>',
        contentText: 'Authoritative product',
      },
      { id: contentId, existingContent: null },
    )
    expect(JSON.stringify(result)).not.toContain('Caller controlled product')
  })

  it('rejects template link persistence when a stale wildcard grant names a disabled peer module', async () => {
    const harness = buildHarness()
    harness.rbacService.loadAcl.mockResolvedValue({
      isSuperAdmin: true,
      features: ['*'],
      organizations: null,
    })
    configureProductInstantiationReads(harness)
    mockIsDocumentEntityRegistryModuleEnabled.mockReturnValue(false)
    mockPrepareTemplateRender.mockResolvedValue(productRender('Visible product'))

    await expect(
      instantiateDocumentCommand.execute(inputWithProduct(), harness.ctx),
    ).rejects.toMatchObject({ status: 403 })

    expect(harness.em.rollback).toHaveBeenCalledTimes(1)
    expect(harness.em.create).not.toHaveBeenCalled()
    expect(mockMutateDocumentContentState).not.toHaveBeenCalled()
  })

  it('runs the authoritative render before the aggregate transaction begins', async () => {
    const harness = buildHarness()
    harness.rbacService.loadAcl.mockResolvedValue({
      isSuperAdmin: false,
      features: ['documents.create', 'documents.edit', 'catalog.products.view'],
      organizations: null,
    })
    configureProductInstantiationReads(harness)
    mockPrepareTemplateRender.mockImplementation(async () => {
      harness.order.push('render')
      return productRender('Atlas Runner')
    })
    mockMutateDocumentContentState.mockImplementation(async (
      _em: EntityManager,
      _documentId: string,
      scope: { tenantId: string; organizationId: string },
      state: { yjsState: Buffer; contentHtml: string; contentText: string },
      options: { id: string },
    ) => Object.assign(new DocumentContent(), {
      id: options.id,
      ...scope,
      documentId,
      ...state,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }))

    await instantiateDocumentCommand.execute(inputWithProduct(), harness.ctx)

    expect(mockPrepareTemplateRender).toHaveBeenCalledTimes(1)
    expect(harness.order.indexOf('render')).toBeGreaterThanOrEqual(0)
    expect(harness.order.indexOf('render')).toBeLessThan(harness.order.indexOf('begin'))
    expect(harness.order.indexOf('begin')).toBeLessThan(harness.order.indexOf('lock-template'))
  })

  it.each([
    [403, 'documents.links.targetRestricted'],
    [400, 'documents.links.targetMismatch'],
  ])('rejects with %s before any transaction when the authoritative render fails', async (
    status,
    error,
  ) => {
    const harness = buildHarness()
    harness.rbacService.loadAcl.mockResolvedValue({
      isSuperAdmin: false,
      features: ['documents.create', 'documents.edit', 'catalog.products.view'],
      organizations: null,
    })
    configureProductInstantiationReads(harness)
    mockPrepareTemplateRender.mockRejectedValueOnce(new CrudHttpError(status, { error }))

    await expect(
      instantiateDocumentCommand.execute(inputWithProduct(), harness.ctx),
    ).rejects.toMatchObject({ status, body: { error } })

    expect(mockPrepareTemplateRender).toHaveBeenCalledTimes(1)
    expect(harness.em.begin).not.toHaveBeenCalled()
    expect(harness.em.rollback).not.toHaveBeenCalled()
    expect(harness.em.create).not.toHaveBeenCalled()
    expect(harness.em.persist).not.toHaveBeenCalled()
    expect(mockMutateDocumentContentState).not.toHaveBeenCalled()
    expect(harness.order).not.toContain('lock-template')
    expect(harness.order).not.toContain('lock-document-slot')
  })

  it('aborts before aggregate creation when the locked template revision changed after rendering', async () => {
    const harness = buildHarness()
    const template = Object.assign(new DocumentTemplate(), {
      id: templateId,
      tenantId,
      organizationId,
      name: 'Review',
      bodyHtml: '<p>Review</p>',
      createdByUserId: actorUserId,
      isActive: true,
      updatedAt: now,
      deletedAt: null,
    })
    const staleTemplate = Object.assign(new DocumentTemplate(), {
      ...template,
      updatedAt: new Date(now.getTime() + 1_000),
    })
    const folder = Object.assign(new DocumentFolder(), {
      id: folderId,
      tenantId,
      organizationId,
      name: 'Reviews',
      ownerUserId: actorUserId,
      updatedAt: now,
      deletedAt: null,
    })
    mockFindOneWithDecryption.mockImplementation(async (
      _em: EntityManager,
      entity: unknown,
      _where: unknown,
      options?: { lockMode?: LockMode },
    ) => {
      if (entity === DocumentTemplate) {
        if (options?.lockMode === LockMode.PESSIMISTIC_READ) {
          harness.order.push('lock-template')
          return staleTemplate
        }
        return template
      }
      if (entity === DocumentFolder) return folder
      if (entity === Document) {
        harness.order.push('lock-document-slot')
        return null
      }
      if (entity === DocumentContent) return null
      throw new Error('Unexpected read')
    })
    mockFindWithDecryption.mockResolvedValue([])
    mockPrepareTemplateRender.mockResolvedValue({
      verifiedSlots: [],
      content: { yjsState: Buffer.from('snapshot'), html: '<p>Review</p>', text: 'Review' },
    })

    await expect(instantiateDocumentCommand.execute(input(), harness.ctx)).rejects.toMatchObject({
      status: 409,
      body: { error: 'documents.templates.staleTemplate' },
    })

    expect(harness.order.indexOf('begin')).toBeLessThan(harness.order.indexOf('lock-template'))
    expect(harness.order).not.toContain('lock-document-slot')
    expect(harness.em.create).not.toHaveBeenCalled()
    expect(harness.em.persist).not.toHaveBeenCalled()
    expect(harness.em.rollback).toHaveBeenCalledTimes(1)
    expect(mockMutateDocumentContentState).not.toHaveBeenCalled()
  })

  it('revalidates every linked entity feature after locking and rejects a revoked target grant', async () => {
    const harness = buildHarness()
    harness.rbacService.loadAcl
      .mockResolvedValueOnce({
        isSuperAdmin: false,
        features: ['documents.create', 'documents.edit', 'catalog.products.view'],
        organizations: null,
      })
      .mockResolvedValueOnce({
        isSuperAdmin: false,
        features: ['documents.create', 'documents.edit'],
        organizations: null,
      })
    const template = Object.assign(new DocumentTemplate(), {
      id: templateId,
      tenantId,
      organizationId,
      name: 'Product review',
      bodyHtml: '<p>Review</p>',
      createdByUserId: actorUserId,
      isActive: true,
      updatedAt: now,
      deletedAt: null,
    })
    const folder = Object.assign(new DocumentFolder(), {
      id: folderId,
      tenantId,
      organizationId,
      name: 'Reviews',
      ownerUserId: actorUserId,
      updatedAt: now,
      deletedAt: null,
    })
    mockFindOneWithDecryption.mockImplementation(async (
      _em: EntityManager,
      entity: unknown,
      _where: unknown,
    ) => {
      if (entity === DocumentTemplate) return template
      if (entity === DocumentFolder) return folder
      if (entity === Document || entity === DocumentContent) return null
      throw new Error('Unexpected read')
    })
    mockFindWithDecryption.mockResolvedValue([])
    mockPrepareTemplateRender.mockResolvedValue({
      verifiedSlots: inputWithProduct().slots,
      content: { yjsState: Buffer.from('snapshot'), html: '<p>Review</p>', text: 'Review' },
    })

    await expect(
      instantiateDocumentCommand.execute(inputWithProduct(), harness.ctx),
    ).rejects.toMatchObject({ status: 403 })

    expect(harness.rbacService.loadAcl).toHaveBeenCalledTimes(2)
    expect(harness.em.create).not.toHaveBeenCalled()
    expect(harness.em.persist).not.toHaveBeenCalled()
    expect(mockMutateDocumentContentState).not.toHaveBeenCalled()
    expect(harness.em.rollback).toHaveBeenCalledTimes(1)
  })
})
