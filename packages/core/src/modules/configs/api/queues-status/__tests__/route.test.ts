/** @jest-environment node */

const authState: { auth: { sub: string; tenantId: string | null; orgId: string | null; isSuperAdmin?: boolean } | null } = {
  auth: { sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' },
}

const userHasAllFeatures = jest.fn(async () => false)
const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'rbacService') return { userHasAllFeatures }
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => authState.auth),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

const buildQueueStatusSnapshot = jest.fn(async () => ({ generatedAt: 'now', filter: { queue: null, type: null }, queues: [], canInspectPayloads: false }))
jest.mock('../../../lib/queue-status', () => ({
  buildQueueStatusSnapshot: (...args: unknown[]) => buildQueueStatusSnapshot(...args),
}))

import { GET } from '../route'

beforeEach(() => {
  jest.clearAllMocks()
  authState.auth = { sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' }
  userHasAllFeatures.mockResolvedValue(false)
  buildQueueStatusSnapshot.mockResolvedValue({ generatedAt: 'now', filter: { queue: null, type: null }, queues: [], canInspectPayloads: false })
})

describe('GET /api/configs/queues-status', () => {
  it('returns 401 when unauthenticated', async () => {
    authState.auth = null
    const res = await GET(new Request('http://localhost/api/configs/queues-status'))
    expect(res.status).toBe(401)
  })

  it('returns the snapshot and echoes canInspectPayloads from the rbac check', async () => {
    userHasAllFeatures.mockResolvedValue(true)

    const res = await GET(new Request('http://localhost/api/configs/queues-status'))

    expect(res.status).toBe(200)
    expect(buildQueueStatusSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ queue: null, type: null, canInspectPayloads: true }),
    )
    expect(userHasAllFeatures).toHaveBeenCalledWith(
      'user-1',
      ['configs.queues_status.inspect_payloads'],
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
  })

  it('parses ?queue= and ?type= and passes them through', async () => {
    const res = await GET(new Request('http://localhost/api/configs/queues-status?queue=my-queue&type=my-type'))

    expect(res.status).toBe(200)
    expect(buildQueueStatusSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ queue: 'my-queue', type: 'my-type' }),
    )
  })

  it('returns 500 when the snapshot builder throws', async () => {
    buildQueueStatusSnapshot.mockRejectedValueOnce(new Error('boom'))

    const res = await GET(new Request('http://localhost/api/configs/queues-status'))

    expect(res.status).toBe(500)
  })

  it('defaults canInspectPayloads to false when the rbac check throws', async () => {
    userHasAllFeatures.mockRejectedValueOnce(new Error('rbac unavailable'))

    const res = await GET(new Request('http://localhost/api/configs/queues-status'))

    expect(res.status).toBe(200)
    expect(buildQueueStatusSnapshot).toHaveBeenCalledWith(expect.objectContaining({ canInspectPayloads: false }))
  })
})
