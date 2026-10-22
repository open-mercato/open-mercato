import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { GeneratedDocument } from '../../../data/entities'
import { GeneratedDocumentRetentionService } from '../generated-document-retention-service'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findWithDecryption: jest.fn() }))

const findMock = findWithDecryption as jest.Mock

const scope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
  resourceKind: 'sales.order',
  resourceId: '33333333-3333-4333-8333-333333333333',
}

function record(overrides: Partial<GeneratedDocument> = {}): GeneratedDocument {
  const entity = new GeneratedDocument()
  Object.assign(entity, {
    id: 'history-1',
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    resourceKind: scope.resourceKind,
    resourceId: scope.resourceId,
    resourceLabel: 'ORD-0001 ACME',
    templateId: 'sales.order-invoice',
    templateLabel: 'Invoice',
    generatedBy: '44444444-4444-4444-8444-444444444444',
    generatedAt: new Date('2026-10-01T10:00:00.000Z'),
    attachmentId: null,
    ...overrides,
  })
  return entity
}

function createEm() {
  const writeEm = { flush: jest.fn(async () => undefined) }
  const em = { fork: jest.fn(() => writeEm) }
  return { em, writeEm }
}

describe('GeneratedDocumentRetentionService', () => {
  beforeEach(() => {
    findMock.mockReset()
  })

  it('scopes the lookup to the tenant, organization and source record', async () => {
    const { em } = createEm()
    findMock.mockResolvedValue([])
    const service = new GeneratedDocumentRetentionService(em as never)

    await service.eraseForResource(scope)

    expect(findMock).toHaveBeenCalledWith(
      expect.anything(),
      GeneratedDocument,
      scope,
      {},
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
    )
  })

  it('does nothing when the source record has no generated documents', async () => {
    const { em, writeEm } = createEm()
    findMock.mockResolvedValue([])
    const remover = jest.fn()
    const service = new GeneratedDocumentRetentionService(em as never, remover)

    await expect(service.eraseForResource(scope)).resolves.toEqual({ anonymizedCount: 0, removedAttachmentIds: [] })
    expect(remover).not.toHaveBeenCalled()
    expect(writeEm.flush).not.toHaveBeenCalled()
  })

  it('anonymizes the label to the source id and unlinks stored files', async () => {
    const { em, writeEm } = createEm()
    const first = record({ id: 'history-1', attachmentId: 'attachment-1' })
    const second = record({ id: 'history-2', attachmentId: 'attachment-2' })
    const third = record({ id: 'history-3', attachmentId: null })
    findMock.mockResolvedValue([first, second, third])
    const remover = jest.fn(async () => undefined)
    const service = new GeneratedDocumentRetentionService(em as never, remover)

    const result = await service.eraseForResource(scope)

    expect(remover).toHaveBeenCalledWith({
      documents: [
        { attachmentId: 'attachment-1', historyId: 'history-1', resourceId: scope.resourceId },
        { attachmentId: 'attachment-2', historyId: 'history-2', resourceId: scope.resourceId },
      ],
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    for (const entry of [first, second, third]) {
      expect(entry.resourceLabel).toBe(scope.resourceId)
      expect(entry.attachmentId).toBeNull()
    }
    expect(writeEm.flush).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ anonymizedCount: 3, removedAttachmentIds: ['attachment-1', 'attachment-2'] })
  })

  it('anonymizes history without stored files when no remover is wired', async () => {
    const { em, writeEm } = createEm()
    const entry = record({ attachmentId: null })
    findMock.mockResolvedValue([entry])
    const service = new GeneratedDocumentRetentionService(em as never)

    await expect(service.eraseForResource(scope)).resolves.toEqual({ anonymizedCount: 1, removedAttachmentIds: [] })
    expect(entry.resourceLabel).toBe(scope.resourceId)
    expect(writeEm.flush).toHaveBeenCalledTimes(1)
  })

  it('refuses to orphan stored files when no remover is available', async () => {
    const { em, writeEm } = createEm()
    const entry = record({ attachmentId: 'attachment-1' })
    findMock.mockResolvedValue([entry])
    const service = new GeneratedDocumentRetentionService(em as never)

    await expect(service.eraseForResource(scope)).rejects.toThrow('refusing to orphan generated files')
    expect(entry.attachmentId).toBe('attachment-1')
    expect(writeEm.flush).not.toHaveBeenCalled()
  })

  it('keeps history untouched when removing stored files fails', async () => {
    const { em, writeEm } = createEm()
    const entry = record({ attachmentId: 'attachment-1' })
    findMock.mockResolvedValue([entry])
    const service = new GeneratedDocumentRetentionService(em as never, jest.fn(async () => {
      throw new Error('storage unavailable')
    }))

    await expect(service.eraseForResource(scope)).rejects.toThrow('storage unavailable')
    expect(entry.resourceLabel).toBe('ORD-0001 ACME')
    expect(entry.attachmentId).toBe('attachment-1')
    expect(writeEm.flush).not.toHaveBeenCalled()
  })
})
