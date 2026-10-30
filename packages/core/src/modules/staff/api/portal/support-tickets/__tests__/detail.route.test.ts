/** @jest-environment node */

const mockResolveScope = jest.fn()
const mockLoadOwnedTicket = jest.fn()

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const CUSTOMER_ID = '33333333-3333-4333-8333-333333333333'
const SIGNED_IN_USER_ID = '44444444-4444-4444-8444-444444444444'
const COLLEAGUE_USER_ID = '44444444-4444-4444-8444-4444444444ff'
const TASK_ID = '55555555-5555-4555-8555-555555555555'
const OWN_COMMENT_ID = '66666666-6666-4666-8666-666666666666'
const COLLEAGUE_COMMENT_ID = '66666666-6666-4666-8666-6666666666ff'

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => null,
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async () => []),
}))

jest.mock('../../../../lib/support/portalTickets', () => ({
  PORTAL_SUPPORT_TICKETS_VIEW_FEATURE: 'portal.support_tickets.view',
  PORTAL_SUPPORT_TICKETS_MANAGE_FEATURE: 'portal.support_tickets.manage',
  resolveSupportPortalScope: (...args: unknown[]) => mockResolveScope(...args),
  loadPortalOwnedTicket: (...args: unknown[]) => mockLoadOwnedTicket(...args),
}))

jest.mock('../../../../lib/support/portalAttachments', () => ({
  loadPortalAttachmentsApi: jest.fn(async () => null),
  listCustomerVisibleAttachments: jest.fn(async () => []),
  portalSupportAttachmentItemSchema: jest.requireActual('zod').z.object({}).passthrough(),
}))

import { GET } from '../[id]/route'

function customerComment(id: string, authorCustomerUserId: string, displayName: string) {
  return {
    id,
    authorKind: 'customer',
    authorUserId: null,
    authorCustomerUserId,
    authorDisplaySnapshot: { displayName },
    body: `Message ${id}`,
    createdAt: new Date('2026-10-27T12:00:00.000Z'),
  }
}

function buildScope(comments: Record<string, unknown>[]) {
  return {
    auth: { sub: SIGNED_IN_USER_ID, tenantId: TENANT_ID, orgId: ORG_ID },
    customerId: CUSTOMER_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    container: { resolve: jest.fn() },
    em: {
      findOne: jest.fn(async () => ({ id: 'status', isDefault: true, isDone: false })),
      find: jest.fn(async () => comments),
    },
    hasFeature: jest.fn(async () => false),
  }
}

function ownedTicket(reportedByCustomerUserId: string) {
  return {
    task: {
      id: TASK_ID,
      taskStatusId: 'status',
      createdAt: new Date('2026-10-27T11:00:00.000Z'),
      updatedAt: new Date('2026-10-27T12:00:00.000Z'),
    },
    ticket: {
      supportReference: 'SUP-1',
      customerRequestSnapshot: { subject: 'Printer', body: 'It is on fire.' },
      categorySnapshot: { value: 'general', label: 'General question' },
      customerSnapshot: { displayName: 'Acme', kind: 'company', reporterDisplayName: 'Ann Buyer' },
      reportedByCustomerUserId,
    },
  }
}

async function readDetail(): Promise<Record<string, unknown>> {
  const response = await GET(new Request(`https://test.local/api/staff/portal/support-tickets/${TASK_ID}`))
  expect(response.status).toBe(200)
  return (await response.json()) as Record<string, unknown>
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('portal support ticket detail authorship', () => {
  it('names the colleague who filed the ticket instead of addressing the viewer as its author', async () => {
    mockResolveScope.mockResolvedValue(buildScope([]))
    mockLoadOwnedTicket.mockResolvedValue(ownedTicket(COLLEAGUE_USER_ID))

    const detail = await readDetail()

    expect(detail.requester).toEqual({ name: 'Ann Buyer', isSelf: false })
  })

  it('marks the original request as the viewer own when they filed it', async () => {
    mockResolveScope.mockResolvedValue(buildScope([]))
    mockLoadOwnedTicket.mockResolvedValue(ownedTicket(SIGNED_IN_USER_ID))

    const detail = await readDetail()

    expect(detail.requester).toEqual({ name: 'Ann Buyer', isSelf: true })
  })

  it('marks only the viewer own customer replies as theirs', async () => {
    mockResolveScope.mockResolvedValue(buildScope([
      customerComment(OWN_COMMENT_ID, SIGNED_IN_USER_ID, 'Vic Viewer'),
      customerComment(COLLEAGUE_COMMENT_ID, COLLEAGUE_USER_ID, 'Ann Buyer'),
    ]))
    mockLoadOwnedTicket.mockResolvedValue(ownedTicket(COLLEAGUE_USER_ID))

    const detail = await readDetail()

    expect(detail.messages).toEqual([
      expect.objectContaining({ id: OWN_COMMENT_ID, authorName: 'Vic Viewer', isSelf: true }),
      expect.objectContaining({ id: COLLEAGUE_COMMENT_ID, authorName: 'Ann Buyer', isSelf: false }),
    ])
  })
})
