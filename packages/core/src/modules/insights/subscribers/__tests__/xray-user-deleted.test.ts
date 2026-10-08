const eraseXrayActorMock = jest.fn(async () => 3)

jest.mock('../../lib/projection/jobs', () => ({
  eraseXrayActor: (...args: unknown[]) => eraseXrayActorMock(...(args as [])),
}))

jest.mock('@open-mercato/shared/lib/logger', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/logger')
  const silent = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), trace: jest.fn(), child: () => silent }
  return { ...actual, createLogger: () => silent }
})

import handler, { metadata } from '../xray-user-deleted'

const TENANT_ID = '11111111-0000-4000-8000-000000000001'
const USER_ID = 'AAAAAAAA-0000-4000-8000-000000000001'

describe('X-Ray user deletion subscriber', () => {
  const ctx = { resolve: jest.fn() }

  beforeEach(() => eraseXrayActorMock.mockClear())

  it('subscribes persistently to the auth user deletion event', () => {
    expect(metadata).toEqual({ event: 'auth.user.deleted', persistent: true, id: 'insights:xray-user-deleted' })
  })

  it('erases the deleted user within the tenant of the event (CRUD payload `id`)', async () => {
    await handler({ id: USER_ID, tenantId: TENANT_ID }, ctx)
    expect(eraseXrayActorMock).toHaveBeenCalledWith(expect.objectContaining({ resolve: expect.any(Function) }), TENANT_ID, USER_ID.toLowerCase())
  })

  it('fails so the persistent delivery retries when the erasure cannot complete', async () => {
    eraseXrayActorMock.mockRejectedValueOnce(new Error('[internal] The tenant key for Process X-Ray actor pseudonyms is unavailable'))
    await expect(handler({ id: USER_ID, tenantId: TENANT_ID }, ctx)).rejects.toThrow('tenant key')
  })

  it('accepts a `userId` payload and never erases without a tenant', async () => {
    await handler({ userId: USER_ID, tenantId: TENANT_ID }, ctx)
    expect(eraseXrayActorMock).toHaveBeenCalledTimes(1)
    await handler({ id: USER_ID }, ctx)
    await handler({ id: 'not-a-uuid', tenantId: TENANT_ID }, ctx)
    expect(eraseXrayActorMock).toHaveBeenCalledTimes(1)
  })
})
