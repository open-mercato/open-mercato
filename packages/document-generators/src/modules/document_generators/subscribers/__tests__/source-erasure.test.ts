import { templateRegistry } from '../../lib/template-registry'
import { GeneratedDocumentRetentionService } from '../../services/generated-document-retention-service'
import handler, { metadata, resolveErasedResourceKind } from '../source-erasure'

jest.mock('../../lib/template-registry', () => ({ templateRegistry: { listTemplates: jest.fn() } }))
jest.mock('../../services/generated-document-retention-service', () => ({
  GeneratedDocumentRetentionService: jest.fn(),
}))

const listTemplatesMock = templateRegistry.listTemplates as jest.Mock
const ServiceMock = GeneratedDocumentRetentionService as unknown as jest.Mock

const payload = {
  id: '33333333-3333-4333-8333-333333333333',
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}

describe('source erasure subscriber', () => {
  const eraseForResource = jest.fn(async () => ({ anonymizedCount: 1, removedAttachmentIds: [] }))
  const em = { name: 'em' }
  const resolve = jest.fn((name: string) => (name === 'em' ? em : undefined))

  beforeEach(() => {
    listTemplatesMock.mockReset()
    eraseForResource.mockClear()
    resolve.mockClear()
    ServiceMock.mockReset()
    ServiceMock.mockImplementation(() => ({ eraseForResource }))
    listTemplatesMock.mockImplementation((filter: { resourceKind?: string }) => (
      filter.resourceKind === 'sales.order' ? [{ id: 'sales.order-invoice' }] : []
    ))
  })

  it('subscribes persistently to every event', () => {
    expect(metadata).toEqual({ event: '*', persistent: true, id: 'document_generators:source-erasure' })
  })

  it('maps deleted events only for resource kinds with registered templates', () => {
    expect(resolveErasedResourceKind('sales.order.deleted')).toBe('sales.order')
    expect(resolveErasedResourceKind('sales.order.updated')).toBeNull()
    expect(resolveErasedResourceKind('customers.person.deleted')).toBeNull()
    expect(resolveErasedResourceKind('document_generators.generated_document.deleted')).toBeNull()
    expect(resolveErasedResourceKind(undefined)).toBeNull()
  })

  it('erases generated documents for the deleted source record in its own scope', async () => {
    await handler(payload, { eventId: 'sales.order.deleted', resolve: resolve as never })

    expect(ServiceMock).toHaveBeenCalledWith(em)
    expect(eraseForResource).toHaveBeenCalledWith({
      tenantId: payload.tenantId,
      organizationId: payload.organizationId,
      resourceKind: 'sales.order',
      resourceId: payload.id,
    })
  })

  it('ignores unrelated events and incomplete payloads', async () => {
    await handler(payload, { eventId: 'sales.order.updated', resolve: resolve as never })
    await handler(payload, { eventId: 'customers.person.deleted', resolve: resolve as never })
    await handler({ id: payload.id, tenantId: payload.tenantId }, { eventId: 'sales.order.deleted', resolve: resolve as never })

    expect(eraseForResource).not.toHaveBeenCalled()
  })

  it('rethrows erasure failures so the persistent event can be retried', async () => {
    eraseForResource.mockRejectedValueOnce(new Error('database unavailable'))

    await expect(handler(payload, { eventName: 'sales.order.deleted', resolve: resolve as never }))
      .rejects.toThrow('database unavailable')
  })
})
