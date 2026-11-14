/** @jest-environment node */

import { getEntityIds, registerEntityIds, type EntityIds } from '@open-mercato/shared/lib/encryption/entityIds'

const mockResolveScope = jest.fn()
const mockLoadOwnedTicket = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockEmFind = jest.fn()
const mockEmFindOne = jest.fn()

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const CUSTOMER_USER_ID = '44444444-4444-4444-8444-444444444444'
const TASK_ID = '55555555-5555-4555-8555-555555555555'
const ATTACHMENT_ID = '77777777-7777-4777-8777-777777777777'
const MISSING_METADATA = '[internal] Metadata for entity Attachment not found'

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
  runRouteMutationGuards: jest.fn(async () => ({ ok: true, runAfterSuccess: async () => undefined })),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
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

jest.mock('../../../../lib/support/dictionaries', () => ({
  loadSupportTicketCategories: jest.fn(async () => [{ value: 'billing', label: 'Billing' }]),
}))

jest.mock('../../../../lib/support/routing', () => ({
  resolveRoutableCategoryValues: jest.fn(async () => new Set(['billing'])),
}))

import { DELETE, GET, POST } from '../[id]/attachments/route'
import { GET as getOptions } from '../options/route'

const attachmentsUrl = `http://localhost/api/staff/portal/support-tickets/${TASK_ID}/attachments`

function uploadRequest(): Request {
  const form = new FormData()
  form.set('file', new File([new Uint8Array([0x41, 0x42])], 'invoice.pdf', { type: 'application/pdf' }))
  return new Request(attachmentsUrl, { method: 'POST', body: form })
}

describe('portal support ticket attachments when the attachments module is disabled', () => {
  let previousEntityIds: EntityIds

  beforeEach(() => {
    jest.clearAllMocks()
    previousEntityIds = getEntityIds(false)
    registerEntityIds({ staff: { staff_team_member: 'staff:staff_team_member' } })
    mockResolveScope.mockResolvedValue({
      auth: { sub: CUSTOMER_USER_ID, tenantId: TENANT_ID, orgId: ORG_ID, email: 'pat@example.com' },
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      container: { resolve: jest.fn(() => undefined) },
      em: { find: mockEmFind, findOne: mockEmFindOne },
      hasFeature: jest.fn(async () => true),
    })
    mockLoadOwnedTicket.mockResolvedValue({ task: { id: TASK_ID } })
    mockFindWithDecryption.mockRejectedValue(new Error(MISSING_METADATA))
    mockFindOneWithDecryption.mockRejectedValue(new Error(MISSING_METADATA))
    mockEmFind.mockRejectedValue(new Error(MISSING_METADATA))
    mockEmFindOne.mockRejectedValue(new Error(MISSING_METADATA))
  })

  afterEach(() => {
    registerEntityIds(previousEntityIds)
  })

  it('answers 503 when listing files', async () => {
    const response = await GET(new Request(attachmentsUrl))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'staff.support.errors.attachmentsUnavailable' })
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
  })

  it('answers 503 when streaming a file', async () => {
    const response = await GET(new Request(`${attachmentsUrl}?attachmentId=${ATTACHMENT_ID}`))

    expect(response.status).toBe(503)
    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
  })

  it('answers 503 when uploading a file', async () => {
    const response = await POST(uploadRequest())

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'staff.support.errors.attachmentsUnavailable' })
  })

  it('answers 503 when deleting a file', async () => {
    const response = await DELETE(new Request(`${attachmentsUrl}?attachmentId=${ATTACHMENT_ID}`, { method: 'DELETE' }))

    expect(response.status).toBe(503)
    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
  })

  it('still answers 404 for a ticket the customer does not own', async () => {
    mockLoadOwnedTicket.mockResolvedValue(null)

    const response = await GET(new Request(attachmentsUrl))

    expect(response.status).toBe(404)
  })

  it('reports no upload limit in the form options', async () => {
    const response = await getOptions(new Request('http://localhost/api/staff/portal/support-tickets/options'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ canCreate: true, maxUploadBytes: null })
  })

  it('still queries attachments when the module is enabled', async () => {
    registerEntityIds({ attachments: { attachment: 'attachments:attachment' } })
    mockFindWithDecryption.mockResolvedValue([])

    const response = await GET(new Request(attachmentsUrl))

    expect(response.status).toBe(200)
    expect(mockFindWithDecryption).toHaveBeenCalledTimes(1)
  })
})
