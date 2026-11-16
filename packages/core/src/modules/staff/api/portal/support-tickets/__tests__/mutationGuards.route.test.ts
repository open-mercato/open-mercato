/** @jest-environment node */

const mockResolveScope = jest.fn()
const mockLoadOwnedTicket = jest.fn()
const mockResolveCustomerDisplay = jest.fn()
const mockRunRouteMutationGuards = jest.fn()
const mockRunAfterSuccess = jest.fn()
const mockExecute = jest.fn()
const mockUpload = jest.fn()
const mockLoadPortalAttachmentsApi = jest.fn()
const mockEmitAttachmentActivity = jest.fn()

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const CUSTOMER_ID = '33333333-3333-4333-8333-333333333333'
const CUSTOMER_USER_ID = '44444444-4444-4444-8444-444444444444'
const TASK_ID = '55555555-5555-4555-8555-555555555555'
const FOREIGN_TASK_ID = '55555555-5555-4555-8555-5555555555ff'
const FOREIGN_TENANT_ID = '11111111-1111-4111-8111-1111111111ff'
const COMMENT_ID = '66666666-6666-4666-8666-666666666666'
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

jest.mock('../../../../lib/support/portalTickets', () => ({
  PORTAL_SUPPORT_TICKETS_VIEW_FEATURE: 'portal.support_tickets.view',
  PORTAL_SUPPORT_TICKETS_MANAGE_FEATURE: 'portal.support_tickets.manage',
  resolveSupportPortalScope: (...args: unknown[]) => mockResolveScope(...args),
  loadPortalOwnedTicket: (...args: unknown[]) => mockLoadOwnedTicket(...args),
  resolveCustomerDisplay: (...args: unknown[]) => mockResolveCustomerDisplay(...args),
  listPortalTicketPage: jest.fn(),
  portalOwnedTaskWhere: jest.fn(() => ({})),
}))

jest.mock('../../../../lib/support/portalRoute', () => {
  const actual = jest.requireActual('../../../../lib/support/portalRoute')
  return { ...actual, checkPortalRateLimit: jest.fn(async () => null) }
})

jest.mock('../../../../lib/support/portalAttachments', () => ({
  loadPortalAttachmentsApi: (...args: unknown[]) => mockLoadPortalAttachmentsApi(...args),
  listCustomerVisibleAttachments: jest.fn(),
  portalAttachmentAuth: jest.fn(),
  readAttachmentTags: jest.fn(() => []),
  serializePortalAttachment: jest.fn((_api: unknown, attachment: { id: string; fileName: string }) => ({
    id: attachment.id,
    fileName: attachment.fileName,
  })),
  portalSupportAttachmentItemSchema: jest.requireActual('zod').z.object({}).passthrough(),
}))

jest.mock('../../../../lib/support/supportActivity', () => ({
  emitSupportAttachmentActivity: (...args: unknown[]) => mockEmitAttachmentActivity(...args),
}))

import { POST as createTicket } from '../route'
import { POST as replyOnTicket } from '../[id]/messages/route'
import { POST as uploadAttachment } from '../[id]/attachments/route'

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'commandBus') return { execute: mockExecute }
    if (token === 'attachmentScopedUploadService') return { upload: mockUpload }
    return undefined
  }),
}

const scope = {
  auth: { sub: CUSTOMER_USER_ID, tenantId: TENANT_ID, orgId: ORG_ID, displayName: 'Pat Customer', email: 'pat@example.com' },
  customerId: CUSTOMER_ID,
  tenantId: TENANT_ID,
  organizationId: ORG_ID,
  container: mockContainer,
  em: {},
  hasFeature: jest.fn(async () => true),
}

function passGuards(modifiedPayload?: Record<string, unknown>) {
  mockRunRouteMutationGuards.mockResolvedValue({ ok: true, modifiedPayload, runAfterSuccess: mockRunAfterSuccess })
}

function jsonRequest(url: string, body: Record<string, unknown>): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function commandInput(): Record<string, unknown> {
  return mockExecute.mock.calls[0][1].input
}

beforeEach(() => {
  jest.clearAllMocks()
  mockResolveScope.mockResolvedValue(scope)
  mockLoadOwnedTicket.mockResolvedValue({ task: { id: TASK_ID } })
  mockResolveCustomerDisplay.mockResolvedValue({ displayName: 'Acme', kind: 'company' })
  mockLoadPortalAttachmentsApi.mockResolvedValue({
    isMultipartRequestWithinUploadLimit: () => true,
    isScopedAttachmentUploadError: () => false,
  })
})

describe('portal support ticket create', () => {
  const url = 'http://localhost/api/staff/portal/support-tickets'
  const body = { categoryValue: 'billing', subject: 'Invoice question', description: 'My card is 4111 1111 1111 1111' }

  it('dispatches the guard-transformed fields while keeping identity from the portal scope', async () => {
    passGuards({
      categoryValue: 'security',
      description: 'My card is [redacted]',
      tenantId: FOREIGN_TENANT_ID,
      customerUserId: 'spoofed',
    })
    mockExecute.mockResolvedValue({ result: { taskId: TASK_ID, supportReference: 'SUP-1' } })
    const response = await createTicket(jsonRequest(url, body))
    expect(response.status).toBe(201)
    expect(mockRunRouteMutationGuards.mock.calls[0][0].input.mutationPayload).toEqual(body)
    expect(commandInput()).toMatchObject({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      customerId: CUSTOMER_ID,
      customerUserId: CUSTOMER_USER_ID,
      categoryValue: 'security',
      subject: 'Invoice question',
      description: 'My card is [redacted]',
    })
    expect(mockRunAfterSuccess).toHaveBeenCalledTimes(1)
  })

  it('dispatches the original fields when no guard transforms them', async () => {
    passGuards()
    mockExecute.mockResolvedValue({ result: { taskId: TASK_ID, supportReference: 'SUP-1' } })
    const response = await createTicket(jsonRequest(url, body))
    expect(response.status).toBe(201)
    expect(commandInput()).toMatchObject(body)
  })

  it('rejects an invalid transformation with 400 and never dispatches the command', async () => {
    passGuards({ subject: '' })
    const response = await createTicket(jsonRequest(url, body))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, error: 'Invalid request' })
    expect(mockExecute).not.toHaveBeenCalled()
    expect(mockRunAfterSuccess).not.toHaveBeenCalled()
  })
})

describe('portal support ticket reply', () => {
  const url = `http://localhost/api/staff/portal/support-tickets/${TASK_ID}/messages`

  it('dispatches the guard-redacted reply against the owned task only', async () => {
    passGuards({ body: 'Call me on [redacted]', taskId: FOREIGN_TASK_ID, customerId: 'spoofed' })
    mockExecute.mockResolvedValue({ result: { commentId: COMMENT_ID, reopened: false } })
    const response = await replyOnTicket(jsonRequest(url, { body: 'Call me on +48 600 000 000' }))
    expect(response.status).toBe(201)
    expect(commandInput()).toMatchObject({
      taskId: TASK_ID,
      tenantId: TENANT_ID,
      customerId: CUSTOMER_ID,
      customerUserId: CUSTOMER_USER_ID,
      body: 'Call me on [redacted]',
    })
  })

  it('rejects an invalid transformed reply with 400 and never dispatches the command', async () => {
    passGuards({ body: 42 })
    const response = await replyOnTicket(jsonRequest(url, { body: 'Hello' }))
    expect(response.status).toBe(400)
    expect(mockExecute).not.toHaveBeenCalled()
    expect(mockRunAfterSuccess).not.toHaveBeenCalled()
  })
})

describe('portal support ticket attachment upload', () => {
  const url = `http://localhost/api/staff/portal/support-tickets/${TASK_ID}/attachments`

  function uploadRequest(): Request {
    const form = new FormData()
    form.append('file', new File(['hello'], 'passport scan.png', { type: 'image/png' }))
    return new Request(url, { method: 'POST', body: form })
  }

  it('uploads under the guard-transformed file name and type for the owned task', async () => {
    passGuards({ fileName: 'document.png', mimeType: 'application/octet-stream', fileSize: 999999 })
    mockUpload.mockResolvedValue({ id: ATTACHMENT_ID, fileName: 'document.png' })
    const response = await uploadAttachment(uploadRequest())
    expect(response.status).toBe(201)
    expect(mockUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        recordId: TASK_ID,
        fileName: 'document.png',
        declaredMimeType: 'application/octet-stream',
      }),
    )
    expect(mockUpload.mock.calls[0][0].buffer.length).toBe(5)
  })

  it('announces the customer upload to open backoffice screens once it is stored', async () => {
    const owned = { task: { id: TASK_ID }, ticket: { id: 'ticket-1' } }
    mockLoadOwnedTicket.mockResolvedValue(owned)
    passGuards()
    mockUpload.mockResolvedValue({ id: ATTACHMENT_ID, fileName: 'passport scan.png' })
    const response = await uploadAttachment(uploadRequest())
    expect(response.status).toBe(201)
    expect(mockEmitAttachmentActivity).toHaveBeenCalledTimes(1)
    expect(mockEmitAttachmentActivity).toHaveBeenCalledWith(owned.task, owned.ticket, 'attachment_added', ATTACHMENT_ID)
  })

  it('rejects an invalid transformed file name with 400 and stores nothing', async () => {
    passGuards({ fileName: '   ' })
    const response = await uploadAttachment(uploadRequest())
    expect(response.status).toBe(400)
    expect(mockUpload).not.toHaveBeenCalled()
    expect(mockRunAfterSuccess).not.toHaveBeenCalled()
    expect(mockEmitAttachmentActivity).not.toHaveBeenCalled()
  })
})
