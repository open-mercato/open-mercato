import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { entityReferenceLockKey } from '@open-mercato/shared/lib/entities/reference-lock'
import { Document, DocumentEntityLink } from '../data/entities'

const mockFindOneWithDecryption = jest.fn()
const mockAssertDocumentCommandCanEdit = jest.fn()
const mockVerifyEntityRegistrySelection = jest.fn()
const mockIsDocumentEntityRegistryModuleEnabled = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

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
} from '../commands/links'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const actorUserId = '33333333-3333-4333-8333-333333333333'
const documentId = '44444444-4444-4444-8444-444444444444'
const linkId = '55555555-5555-4555-8555-555555555555'
const dealId = '66666666-6666-4666-8666-666666666666'
const productId = '77777777-7777-4777-8777-777777777777'
const updatedAt = '2026-07-10T12:00:00.000Z'
const ADVISORY_LOCK_SQL = 'select pg_advisory_xact_lock(hashtextextended(?::text, 0))'

function verifiedDeal() {
  return { id: dealId, label: 'Atlas renewal', href: `/backend/customers/deals/${dealId}`, values: {} }
}

function dealLinkInput(): LinkCreateCommandInput {
  return {
    tenantId,
    organizationId,
    documentId,
    linkId,
    link: {
      entityType: 'deal',
      entityId: dealId,
      label: 'Atlas renewal',
      href: `/backend/customers/deals/${dealId}`,
      source: 'related-panel',
    },
  }
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

function makeDealLink(deletedAt: Date): DocumentEntityLink {
  return Object.assign(new DocumentEntityLink(), {
    id: linkId,
    tenantId,
    organizationId,
    documentId,
    dealId,
    labelSnapshot: 'Atlas renewal',
    hrefSnapshot: `/backend/customers/deals/${dealId}`,
    source: 'related-panel',
    createdByUserId: actorUserId,
    createdAt: new Date(updatedAt),
    updatedAt: deletedAt,
    deletedAt,
  })
}

function buildHarness(dealExists: boolean) {
  const order: string[] = []
  const execute = jest.fn(async (sql: string) => {
    if (sql === ADVISORY_LOCK_SQL) {
      order.push('lock-deal')
      return []
    }
    order.push('check-deal')
    return dealExists ? [{ '?column?': 1 }] : []
  })
  const em = {
    fork: jest.fn(() => em),
    begin: jest.fn(async () => { order.push('begin') }),
    flush: jest.fn(async () => { order.push('flush') }),
    commit: jest.fn(async () => { order.push('commit') }),
    rollback: jest.fn(async () => { order.push('rollback') }),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => (
      Object.assign(new DocumentEntityLink(), data)
    )),
    persist: jest.fn(),
    count: jest.fn(async () => 0),
    execute,
  } as unknown as EntityManager
  const ctx: CommandRuntimeContext = {
    container: {
      resolve: (token: string) => {
        if (token === 'em') return em
        if (token === 'dataEngine') return { markOrmEntityChange: jest.fn() }
        if (token === 'rbacService') {
          return {
            invalidateUserCache: jest.fn(async () => undefined),
            loadAcl: jest.fn(async () => ({
              isSuperAdmin: false,
              features: ['documents.edit', 'customers.deals.view', 'catalog.products.view'],
              organizations: null,
            })),
          }
        }
        throw new Error(`Unexpected dependency: ${token}`)
      },
    } as CommandRuntimeContext['container'],
    auth: {
      sub: actorUserId,
      userId: actorUserId,
      tenantId,
      orgId: organizationId,
      features: ['documents.edit', 'customers.deals.view', 'catalog.products.view'],
    } as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
    request: new Request('http://localhost/api/documents/link'),
  }
  mockAssertDocumentCommandCanEdit.mockImplementation(async () => {
    order.push('authorize')
    return ['documents.edit', 'customers.deals.view', 'catalog.products.view']
  })
  return { ctx, em, execute, order }
}

const expectedLockKey = entityReferenceLockKey({
  entityId: 'customers:customer_deal',
  recordId: dealId,
  tenantId,
  organizationId,
})

describe('document deal link reference lock', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockIsDocumentEntityRegistryModuleEnabled.mockReturnValue(true)
    mockVerifyEntityRegistrySelection.mockResolvedValue(verifiedDeal())
  })

  it('locks the Deal reference and re-verifies the Deal in scope before linking', async () => {
    const harness = buildHarness(true)
    mockFindOneWithDecryption.mockImplementation(async (_em: EntityManager, entity: unknown) => {
      if (entity === Document) {
        harness.order.push('lock-document')
        return makeDocument()
      }
      harness.order.push('lock-link')
      return null
    })

    const result = await createLinkCommand.execute(dealLinkInput(), harness.ctx)

    expect(result.created).toBe(true)
    expect(harness.execute).toHaveBeenNthCalledWith(1, ADVISORY_LOCK_SQL, [expectedLockKey])
    expect(harness.execute).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('from customer_deals'),
      [dealId, tenantId, organizationId],
    )
    expect(harness.order.slice(0, 5)).toEqual(['begin', 'lock-document', 'lock-deal', 'check-deal', 'authorize'])
    expect(harness.em.create).toHaveBeenCalledWith(
      DocumentEntityLink,
      expect.objectContaining({ dealId }),
    )
  })

  it('refuses to link a Deal that a concurrent merge already removed', async () => {
    const harness = buildHarness(false)
    mockFindOneWithDecryption.mockImplementation(async (_em: EntityManager, entity: unknown) => (
      entity === Document ? makeDocument() : null
    ))

    await expect(createLinkCommand.execute(dealLinkInput(), harness.ctx)).rejects.toMatchObject({
      status: 404,
      body: { error: 'documents.links.notFound' },
    })
    expect(harness.em.create).not.toHaveBeenCalled()
    expect(harness.em.persist).not.toHaveBeenCalled()
    expect(harness.order).toContain('rollback')
    expect(harness.order).not.toContain('commit')
  })

  it('does not take a Deal lock for non-Deal targets', async () => {
    const harness = buildHarness(true)
    mockVerifyEntityRegistrySelection.mockResolvedValue({
      id: productId,
      label: 'Atlas Runner',
      href: `/backend/catalog/products/${productId}`,
      values: {},
    })
    mockFindOneWithDecryption.mockImplementation(async (_em: EntityManager, entity: unknown) => (
      entity === Document ? makeDocument() : null
    ))

    await createLinkCommand.execute({
      ...dealLinkInput(),
      link: {
        entityType: 'product',
        entityId: productId,
        label: 'Atlas Runner',
        href: `/backend/catalog/products/${productId}`,
        source: 'related-panel',
      },
    }, harness.ctx)

    expect(harness.execute).not.toHaveBeenCalled()
  })

  it('refuses to resurrect a deleted link to a Deal removed by a merge', async () => {
    const harness = buildHarness(false)
    const deletedAt = new Date('2026-07-10T12:00:01.000Z')
    const link = makeDealLink(deletedAt)
    mockFindOneWithDecryption.mockImplementation(async (_em: EntityManager, entity: unknown) => (
      entity === Document ? makeDocument() : link
    ))

    await expect(deleteLinkCommand.undo!({
      input: {},
      ctx: harness.ctx,
      logEntry: {
        commandPayload: {
          __redoInput: { tenantId, organizationId, documentId, linkId },
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
    })).rejects.toMatchObject({ status: 404, body: { error: 'documents.links.notFound' } })

    expect(harness.execute).toHaveBeenNthCalledWith(1, ADVISORY_LOCK_SQL, [expectedLockKey])
    expect(link.deletedAt).toEqual(deletedAt)
    expect(harness.order).not.toContain('commit')
  })
})
