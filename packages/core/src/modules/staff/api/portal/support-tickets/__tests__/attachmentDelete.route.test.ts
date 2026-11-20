/** @jest-environment node */

const mockResolveScope = jest.fn()
const mockLoadOwnedTicket = jest.fn()
const mockRunRouteMutationGuards = jest.fn()
const mockRunAfterSuccess = jest.fn()
const mockLoadPortalAttachmentsApi = jest.fn()
const mockEmitAttachmentActivity = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockEmitCrudSideEffects = jest.fn()
const mockRemoveAttachmentRecord = jest.fn()
const mockDriverDelete = jest.fn()
const mockClearThumbnails = jest.fn()

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const CUSTOMER_USER_ID = '44444444-4444-4444-8444-444444444444'
const TASK_ID = '55555555-5555-4555-8555-555555555555'
const ATTACHMENT_ID = '77777777-7777-4777-8777-777777777777'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback: string) => fallback,
    t: (_key: string, fallback?: string) => fallback ?? _key,
  })),
}))

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => null,
}))

jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: (...args: unknown[]) => mockRunRouteMutationGuards(...args),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  emitCrudSideEffects: (...args: unknown[]) => mockEmitCrudSideEffects(...args),
}))

jest.mock('../../../../lib/support/portalTickets', () => ({
  PORTAL_SUPPORT_TICKETS_VIEW_FEATURE: 'portal.support_tickets.view',
  PORTAL_SUPPORT_TICKETS_MANAGE_FEATURE: 'portal.support_tickets.manage',
  resolveSupportPortalScope: (...args: unknown[]) => mockResolveScope(...args),
  loadPortalOwnedTicket: (...args: unknown[]) => mockLoadOwnedTicket(...args),
}))

jest.mock('../../../../lib/support/portalRoute', () => {
  const actual = jest.requireActual('../../../../lib/support/portalRoute')
  return { ...actual, checkPortalRateLimit: jest.fn(async () => null) }
})

jest.mock('../../../../lib/support/portalAttachments', () => ({
  loadPortalAttachmentsApi: (...args: unknown[]) => mockLoadPortalAttachmentsApi(...args),
  listCustomerVisibleAttachments: jest.fn(),
  portalAttachmentAuth: jest.fn(),
  readAttachmentTags: jest.fn(() => ['customer-visible', `customer-upload:${CUSTOMER_USER_ID}`]),
  serializePortalAttachment: jest.fn(),
  portalSupportAttachmentItemSchema: jest.requireActual('zod').z.object({}).passthrough(),
}))

jest.mock('../../../../lib/support/supportActivity', () => ({
  emitSupportAttachmentActivity: (...args: unknown[]) => mockEmitAttachmentActivity(...args),
}))

import { DELETE as deleteAttachment } from '../[id]/attachments/route'

const dataEngine = { flushOrmEntityChanges: jest.fn(async () => {}) }
const em = { remove: jest.fn(() => ({ flush: jest.fn() })) }
const scope = {
  auth: { sub: CUSTOMER_USER_ID, tenantId: TENANT_ID, orgId: ORG_ID },
  tenantId: TENANT_ID,
  organizationId: ORG_ID,
  container: {
    resolve: jest.fn((token: string) => {
      if (token === 'storageDriverFactory') return { resolveForPartition: async () => ({ delete: mockDriverDelete }) }
      if (token === 'dataEngine') return dataEngine
      return undefined
    }),
  },
  em,
}
const attachment = {
  id: ATTACHMENT_ID,
  partitionCode: 'support',
  storagePath: 'support/file.pdf',
  tenantId: TENANT_ID,
  organizationId: ORG_ID,
}

function deleteRequest(): Request {
  return new Request(
    `http://localhost/api/staff/portal/support-tickets/${TASK_ID}/attachments?attachmentId=${ATTACHMENT_ID}`,
    { method: 'DELETE' },
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  mockResolveScope.mockResolvedValue(scope)
  mockLoadOwnedTicket.mockResolvedValue({ task: { id: TASK_ID }, ticket: { id: 'ticket-1' } })
  mockRunRouteMutationGuards.mockResolvedValue({ ok: true, runAfterSuccess: mockRunAfterSuccess })
  mockFindOneWithDecryption.mockResolvedValue(attachment)
  mockClearThumbnails.mockResolvedValue(undefined)
  mockLoadPortalAttachmentsApi.mockResolvedValue({
    Attachment: class {},
    removeAttachmentRecord: mockRemoveAttachmentRecord,
    clearAttachmentThumbnailCache: mockClearThumbnails,
    attachmentCrudEvents: {},
    attachmentCrudIndexer: {},
  })
})

describe('portal support ticket attachment delete', () => {
  it('removes the row through removeAttachmentRecord so its document structure is purged', async () => {
    mockRemoveAttachmentRecord.mockResolvedValue({ removed: true, releaseStorage: true })

    const response = await deleteAttachment(deleteRequest())

    expect(response.status).toBe(200)
    expect(mockRemoveAttachmentRecord).toHaveBeenCalledWith(em, attachment)
    expect(em.remove).not.toHaveBeenCalled()
    expect(mockDriverDelete).toHaveBeenCalledWith('support', 'support/file.pdf')
    expect(mockEmitCrudSideEffects).toHaveBeenCalledWith(expect.objectContaining({ action: 'deleted', entity: attachment }))
    expect(mockEmitAttachmentActivity).toHaveBeenCalledWith(
      { id: TASK_ID },
      { id: 'ticket-1' },
      'attachment_removed',
      ATTACHMENT_ID,
    )
  })

  it('keeps the stored bytes when another attachment row still references them', async () => {
    mockRemoveAttachmentRecord.mockResolvedValue({ removed: true, releaseStorage: false })

    const response = await deleteAttachment(deleteRequest())

    expect(response.status).toBe(200)
    expect(mockDriverDelete).not.toHaveBeenCalled()
    expect(mockEmitCrudSideEffects).toHaveBeenCalledTimes(1)
  })

  it('answers 404 with no side effects when a concurrent request already removed the row', async () => {
    mockRemoveAttachmentRecord.mockResolvedValue({ removed: false, releaseStorage: false })

    const response = await deleteAttachment(deleteRequest())

    expect(response.status).toBe(404)
    expect(mockClearThumbnails).not.toHaveBeenCalled()
    expect(mockDriverDelete).not.toHaveBeenCalled()
    expect(mockEmitCrudSideEffects).not.toHaveBeenCalled()
    expect(mockEmitAttachmentActivity).not.toHaveBeenCalled()
    expect(mockRunAfterSuccess).not.toHaveBeenCalled()
  })
})
