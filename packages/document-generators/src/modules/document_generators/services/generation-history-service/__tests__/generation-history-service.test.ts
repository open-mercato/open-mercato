import { GeneratedDocument } from '../../../data/entities'
import { GenerationHistoryService } from '../generation-history-service'
import { findAndCountWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTenantEncryptionService } from '@open-mercato/shared/lib/encryption/customFieldValues'
import { isTenantDataEncryptionEnabled } from '@open-mercato/shared/lib/encryption/toggles'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findAndCountWithDecryption: jest.fn() }))
jest.mock('@open-mercato/shared/lib/encryption/customFieldValues', () => ({ resolveTenantEncryptionService: jest.fn() }))
jest.mock('@open-mercato/shared/lib/encryption/toggles', () => ({ isTenantDataEncryptionEnabled: jest.fn() }))

const findMock = findAndCountWithDecryption as jest.Mock
const resolveServiceMock = resolveTenantEncryptionService as jest.Mock
const enabledMock = isTenantDataEncryptionEnabled as jest.Mock

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const generatedAt = new Date('2026-10-01T10:00:00.000Z')
const baseInput = {
  ...scope,
  resourceKind: 'sales:order',
  resourceId: 'order-1',
  resourceLabel: 'Order #1',
  templateId: 'sales.order.invoice',
  templateLabel: 'Invoice',
  format: 'pdf',
  mimeType: 'application/pdf',
  generatedBy: '33333333-3333-4333-8333-333333333333',
  generatedAt,
}

function createEm() {
  const forked = { persist: jest.fn(), flush: jest.fn(async () => undefined) }
  const em = { fork: jest.fn(() => forked) }
  return { em, forked }
}

function createService(overrides: Record<string, unknown> = {}) {
  return {
    isEnabled: jest.fn(() => true),
    getEncryptedFieldNames: jest.fn(async () => ['resource_label']),
    encryptEntityPayload: jest.fn(async (_id: string, payload: Record<string, unknown>) => ({
      ...payload,
      resource_label: `enc:${payload.resource_label}`,
    })),
    ...overrides,
  }
}

function listQuery(overrides: Record<string, unknown> = {}) {
  return { page: 1, pageSize: 20, sort: 'generated_at', sort_direction: 'desc', ...overrides } as never
}

beforeEach(() => {
  jest.clearAllMocks()
  enabledMock.mockReturnValue(true)
  resolveServiceMock.mockReturnValue(createService())
})

describe('GenerationHistoryService write path', () => {
  it('falls back to the resource id when the label is empty and never stores null', async () => {
    enabledMock.mockReturnValue(false)
    const { em } = createEm()
    const prepared = await new GenerationHistoryService(em as never).prepare({ ...baseInput, resourceLabel: '   ' })
    expect(prepared.entity.resourceLabel).toBe('order-1')
    const nullish = await new GenerationHistoryService(em as never).prepare({ ...baseInput, resourceLabel: null })
    expect(nullish.entity.resourceLabel).toBe('order-1')
  })

  it('encrypts the label during prepare before anything is persisted', async () => {
    const service = createService()
    resolveServiceMock.mockReturnValue(service)
    const { em, forked } = createEm()
    const prepared = await new GenerationHistoryService(em as never).prepare(baseInput)
    expect(prepared.entity.resourceLabel).toBe('enc:Order #1')
    expect(prepared.plaintextResourceLabel).toBe('Order #1')
    expect(forked.persist).not.toHaveBeenCalled()
  })

  it('rejects in prepare when encryption is unavailable and persists nothing', async () => {
    resolveServiceMock.mockReturnValue(createService({ isEnabled: jest.fn(() => false) }))
    const { em, forked } = createEm()
    await expect(new GenerationHistoryService(em as never).prepare(baseInput)).rejects.toThrow('encryption unavailable')
    expect(forked.persist).not.toHaveBeenCalled()
    expect(forked.flush).not.toHaveBeenCalled()
  })

  it('rejects in prepare when the encryption service throws or yields no ciphertext', async () => {
    const { em, forked } = createEm()
    resolveServiceMock.mockReturnValue(createService({ encryptEntityPayload: jest.fn(async () => { throw new Error('kms down') }) }))
    await expect(new GenerationHistoryService(em as never).prepare(baseInput)).rejects.toThrow('kms down')
    resolveServiceMock.mockReturnValue(createService({ encryptEntityPayload: jest.fn(async (_id: string, payload: unknown) => payload) }))
    await expect(new GenerationHistoryService(em as never).prepare(baseInput)).rejects.toThrow('no ciphertext')
    expect(forked.persist).not.toHaveBeenCalled()
  })

  it('persists canonical scope fields and the supplied generatedAt on a forked em', async () => {
    const { em, forked } = createEm()
    const service = new GenerationHistoryService(em as never)
    const prepared = await service.prepare(baseInput)
    const dto = await service.persist(prepared)
    expect(em.fork).toHaveBeenCalledTimes(1)
    const entity = forked.persist.mock.calls[0][0] as GeneratedDocument
    expect(entity).toMatchObject({
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      generatedBy: baseInput.generatedBy,
      mimeType: 'application/pdf',
      attachmentId: null,
    })
    expect(entity.generatedAt).toBe(generatedAt)
    expect(forked.flush).toHaveBeenCalledTimes(1)
    expect(dto).toMatchObject({ resourceLabel: 'Order #1', generatedAt: '2026-10-01T10:00:00.000Z' })
    expect(dto).not.toHaveProperty('mimeType')
    expect(dto).not.toHaveProperty('attachmentId')
  })
})

describe('GenerationHistoryService listAndCount', () => {
  function stubResult() {
    const entity = Object.assign(new GeneratedDocument(), {
      id: 'doc-1',
      ...scope,
      resourceKind: 'sales:order',
      resourceId: 'order-1',
      resourceLabel: 'Order #1',
      templateId: 't',
      templateLabel: 'Invoice',
      format: 'pdf',
      mimeType: 'application/pdf',
      attachmentId: 'att',
      generatedBy: baseInput.generatedBy,
      generatedAt,
    })
    findMock.mockResolvedValue([[entity], 41])
  }

  it('always scopes by tenant and organization and returns decrypted DTOs', async () => {
    stubResult()
    const { em } = createEm()
    const result = await new GenerationHistoryService(em as never).listAndCount(scope, listQuery({ page: 3, pageSize: 10 }))
    const [, entityName, where, options, decryptionScope] = findMock.mock.calls[0]
    expect(entityName).toBe(GeneratedDocument)
    expect(where).toEqual(scope)
    expect(options).toMatchObject({ limit: 10, offset: 20 })
    expect(decryptionScope).toEqual(scope)
    expect(result).toEqual({
      items: [expect.objectContaining({ id: 'doc-1', resourceLabel: 'Order #1', generatedAt: '2026-10-01T10:00:00.000Z' })],
      total: 41,
      page: 3,
      pageSize: 10,
    })
    expect(result.items[0]).not.toHaveProperty('attachmentId')
  })

  it('applies every filter while keeping scope', async () => {
    stubResult()
    const { em } = createEm()
    await new GenerationHistoryService(em as never).listAndCount(scope, listQuery({
      resource_kind: 'sales:order',
      resource_id: 'order-1',
      template_id: 'tpl',
      generated_by: baseInput.generatedBy,
      generated_from: '2026-10-01T00:00:00.000Z',
      generated_to: '2026-10-02T00:00:00.000Z',
    }))
    expect(findMock.mock.calls[0][2]).toEqual({
      ...scope,
      resourceKind: 'sales:order',
      resourceId: 'order-1',
      templateId: 'tpl',
      generatedBy: baseInput.generatedBy,
      generatedAt: { $gte: new Date('2026-10-01T00:00:00.000Z'), $lte: new Date('2026-10-02T00:00:00.000Z') },
    })
  })

  it.each([
    ['template_label', 'templateLabel'],
    ['format', 'format'],
    ['generated_by', 'generatedBy'],
    ['generated_at', 'generatedAt'],
  ])('maps sort %s with direction and a stable id tiebreaker', async (sort, property) => {
    stubResult()
    const { em } = createEm()
    await new GenerationHistoryService(em as never).listAndCount(scope, listQuery({ sort, sort_direction: 'asc' }))
    expect(findMock.mock.calls[0][3].orderBy).toEqual([{ [property]: 'asc' }, { id: 'asc' }])
  })

  it('cannot sort by the encrypted resource label', async () => {
    stubResult()
    const { em } = createEm()
    await new GenerationHistoryService(em as never).listAndCount(scope, listQuery({ sort: 'resource_label' }))
    expect(findMock.mock.calls[0][3].orderBy).toEqual([{ generatedAt: 'desc' }, { id: 'desc' }])
  })
})
