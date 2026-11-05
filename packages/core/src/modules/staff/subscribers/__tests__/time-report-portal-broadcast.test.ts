/**
 * EP-06 — the portal mirror must never be emitted without pinned recipients.
 *
 * The portal SSE stream narrows a broadcast to named customer users only when the
 * payload carries `recipientUserIds`; without them it falls back to every portal
 * connection in the organization, and one organization serves many customers. So
 * "no recipients means no event" is not an optimization, it is the boundary.
 */

const emitStaffEvent = jest.fn(async () => undefined)
const findOneWithDecryption = jest.fn()
const resolvePortalRecipientUserIds = jest.fn()

jest.mock('../../events', () => ({ emitStaffEvent }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption }))
jest.mock('../../lib/time-tracking/portalRecipients', () => ({ resolvePortalRecipientUserIds }))

import handle from '../time-report-portal-broadcast'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION = '22222222-2222-4222-8222-222222222222'
const CUSTOMER = '33333333-3333-4333-8333-333333333333'
const REPORT_ID = '44444444-4444-4444-8444-444444444444'

const em = { fork: () => em }
const ctx = { resolve: <T>(name: string): T => {
  if (name === 'em') return em as unknown as T
  throw new Error(`[internal] unexpected resolve: ${name}`)
} }

const closedReport = {
  id: REPORT_ID,
  reference: 'RAP-2026-001',
  status: 'closed',
  customerId: CUSTOMER,
  periodFrom: new Date('2026-01-01T00:00:00.000Z'),
  periodTo: new Date('2026-01-31T00:00:00.000Z'),
}

const payload = { id: REPORT_ID, tenantId: TENANT, organizationId: ORGANIZATION }

beforeEach(() => {
  emitStaffEvent.mockClear()
  findOneWithDecryption.mockReset().mockResolvedValue(closedReport)
  resolvePortalRecipientUserIds.mockReset().mockResolvedValue(['portal-user-1', 'portal-user-2'])
})

describe('time-report portal broadcast subscriber', () => {
  it('emits with the recipients pinned and no money on the wire', async () => {
    await handle(payload, ctx)
    expect(emitStaffEvent).toHaveBeenCalledTimes(1)
    const [eventId, body] = emitStaffEvent.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(eventId).toBe('staff.timesheets.time_report.portal_published')
    expect(body).toEqual({
      id: REPORT_ID,
      tenantId: TENANT,
      organizationId: ORGANIZATION,
      reference: 'RAP-2026-001',
      periodFrom: '2026-01-01',
      periodTo: '2026-01-31',
      recipientUserIds: ['portal-user-1', 'portal-user-2'],
    })
    for (const key of Object.keys(body)) {
      expect({ key, money: /(rate|cost|amount|currency)/i.test(key) }).toEqual({ key, money: false })
    }
  })

  it('emits nothing when the customer has no portal users', async () => {
    resolvePortalRecipientUserIds.mockResolvedValue([])
    await handle(payload, ctx)
    expect(emitStaffEvent).not.toHaveBeenCalled()
  })

  it('emits nothing for a report that is not closed', async () => {
    findOneWithDecryption.mockResolvedValue({ ...closedReport, status: 'draft' })
    await handle(payload, ctx)
    expect(emitStaffEvent).not.toHaveBeenCalled()
    expect(resolvePortalRecipientUserIds).not.toHaveBeenCalled()
  })

  it('emits nothing when the report is not visible in the event scope', async () => {
    findOneWithDecryption.mockResolvedValue(null)
    await handle(payload, ctx)
    expect(emitStaffEvent).not.toHaveBeenCalled()
  })

  it('emits nothing when the payload carries no tenant or organization', async () => {
    await handle({ id: REPORT_ID, tenantId: null, organizationId: ORGANIZATION }, ctx)
    await handle({ id: REPORT_ID, tenantId: TENANT, organizationId: null }, ctx)
    expect(findOneWithDecryption).not.toHaveBeenCalled()
    expect(emitStaffEvent).not.toHaveBeenCalled()
  })

  it('loads the report inside the event scope, never by id alone', async () => {
    await handle(payload, ctx)
    const [, , where] = findOneWithDecryption.mock.calls[0] as unknown as [unknown, unknown, Record<string, unknown>]
    expect(where).toEqual({
      id: REPORT_ID,
      tenantId: TENANT,
      organizationId: ORGANIZATION,
      deletedAt: null,
    })
  })
})
