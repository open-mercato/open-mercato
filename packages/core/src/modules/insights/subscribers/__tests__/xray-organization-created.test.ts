const ensureXrayIngestScheduleMock = jest.fn(async () => true)

jest.mock('../../lib/projection/queue', () => ({
  ensureXrayIngestSchedule: (...args: unknown[]) => ensureXrayIngestScheduleMock(...(args as [])),
}))

import handler, { metadata } from '../xray-organization-created'

const TENANT_ID = '11111111-0000-4000-8000-000000000001'
const ORG_ID = 'BBBBBBBB-0000-4000-8000-000000000001'

describe('X-Ray organization creation subscriber', () => {
  const ctx = { resolve: jest.fn() }

  beforeEach(() => ensureXrayIngestScheduleMock.mockClear())

  it('subscribes persistently to organization creation', () => {
    expect(metadata).toEqual({ event: 'directory.organization.created', persistent: true, id: 'insights:xray-organization-created' })
  })

  it('registers the ingest tick of the new organization in its tenant', async () => {
    await handler({ id: ORG_ID, organizationId: ORG_ID, tenantId: TENANT_ID }, ctx)
    expect(ensureXrayIngestScheduleMock).toHaveBeenCalledWith(
      expect.objectContaining({ resolve: expect.any(Function) }),
      { tenantId: TENANT_ID, organizationId: ORG_ID.toLowerCase() },
    )
  })

  it('ignores payloads without a tenant or organization', async () => {
    await handler({ id: ORG_ID }, ctx)
    await handler({ organizationId: 'not-a-uuid', tenantId: TENANT_ID }, ctx)
    expect(ensureXrayIngestScheduleMock).not.toHaveBeenCalled()
  })
})
