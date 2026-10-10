const ensureXrayIngestScheduleMock = jest.fn(async () => true)
const ensureXrayCursorMock = jest.fn(async () => ({ id: 'cursor-1' }))

jest.mock('../../lib/projection/queue', () => ({
  ensureXrayIngestSchedule: (...args: unknown[]) => ensureXrayIngestScheduleMock(...(args as [])),
}))

jest.mock('../../lib/projection/jobs', () => ({
  ensureXrayCursor: (...args: unknown[]) => ensureXrayCursorMock(...(args as [])),
}))

jest.mock('@open-mercato/shared/lib/logger', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/logger')
  const silent = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), trace: jest.fn(), child: () => silent }
  return { ...actual, createLogger: () => silent }
})

import handler, { metadata } from '../xray-organization-created'
import { XrayScopeMismatchError } from '../../lib/projection/payloads'

const TENANT_ID = '11111111-0000-4000-8000-000000000001'
const ORG_ID = 'BBBBBBBB-0000-4000-8000-000000000001'

describe('X-Ray organization creation subscriber', () => {
  const ctx = { resolve: jest.fn() }

  beforeEach(() => jest.clearAllMocks())

  it('subscribes persistently to organization creation', () => {
    expect(metadata).toEqual({ event: 'directory.organization.created', persistent: true, id: 'insights:xray-organization-created' })
  })

  it('creates the cursor of the new organization (the system tick then ingests it) and makes sure the tick exists', async () => {
    await handler({ id: ORG_ID, organizationId: ORG_ID, tenantId: TENANT_ID }, ctx)
    expect(ensureXrayCursorMock).toHaveBeenCalledWith(
      expect.objectContaining({ resolve: expect.any(Function) }),
      { tenantId: TENANT_ID, organizationId: ORG_ID.toLowerCase() },
    )
    expect(ensureXrayIngestScheduleMock).toHaveBeenCalledWith(expect.objectContaining({ resolve: expect.any(Function) }))
    expect(ensureXrayIngestScheduleMock.mock.calls[0]).toHaveLength(1)
  })

  it('writes nothing for an organization that does not belong to the tenant of the event', async () => {
    ensureXrayCursorMock.mockRejectedValueOnce(new XrayScopeMismatchError())
    await expect(handler({ id: ORG_ID, tenantId: TENANT_ID }, ctx)).resolves.toBeUndefined()
    expect(ensureXrayIngestScheduleMock).not.toHaveBeenCalled()
  })

  it('rethrows other failures so the persistent subscriber retries', async () => {
    ensureXrayCursorMock.mockRejectedValueOnce(new Error('db down'))
    await expect(handler({ id: ORG_ID, tenantId: TENANT_ID }, ctx)).rejects.toThrow('db down')
  })

  it('ignores payloads without a tenant or organization', async () => {
    await handler({ id: ORG_ID }, ctx)
    await handler({ organizationId: 'not-a-uuid', tenantId: TENANT_ID }, ctx)
    expect(ensureXrayCursorMock).not.toHaveBeenCalled()
    expect(ensureXrayIngestScheduleMock).not.toHaveBeenCalled()
  })
})
