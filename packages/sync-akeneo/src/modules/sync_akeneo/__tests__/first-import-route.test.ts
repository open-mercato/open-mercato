import { POST } from '../api/first-import/route'
import { AKENEO_FIRST_IMPORT_QUEUE } from '../lib/first-import'
import { getSyncQueue } from '@open-mercato/core/modules/data_sync/lib/queue'

const scope = { organizationId: 'org-1', tenantId: 'tenant-1', userId: 'user-1' }
const mockIsEnabled = jest.fn(async () => true)
const mockFindWithDecryption = jest.fn(async () => [])
const mockCreateJob = jest.fn(async () => ({ id: 'sequence-job-1' }))
const mockEnqueue = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: async () => ({ orgId: scope.organizationId, tenantId: scope.tenantId, sub: scope.userId }),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => {
    const services: Record<string, unknown> = {
      em: {},
      integrationStateService: { isEnabled: mockIsEnabled },
      progressService: { createJob: mockCreateJob },
    }
    return { resolve: (name: string) => services[name] }
  },
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: () => mockFindWithDecryption(),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ t: (key: string) => key }),
}))

jest.mock('@open-mercato/core/modules/data_sync/lib/queue', () => ({
  getSyncQueue: jest.fn(() => ({ enqueue: mockEnqueue })),
}))

describe('Akeneo first import admission', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns a conflict for a disabled integration before creating a job', async () => {
    mockIsEnabled.mockResolvedValueOnce(false)

    const response = await POST(new Request('http://localhost/api/sync_akeneo/first-import', { method: 'POST' }))

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ ok: false, error: 'sync_akeneo.firstImport.integrationDisabled' })
    expect(mockIsEnabled).toHaveBeenCalledWith('sync_akeneo', scope)
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
    expect(mockCreateJob).not.toHaveBeenCalled()
    expect(getSyncQueue).not.toHaveBeenCalled()
  })

  it('queues the sequence in the authenticated scope for an enabled integration', async () => {
    const response = await POST(new Request('http://localhost/api/sync_akeneo/first-import', { method: 'POST' }))

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ ok: true, progressJobId: 'sequence-job-1' })
    expect(mockIsEnabled).toHaveBeenCalledWith('sync_akeneo', scope)
    expect(mockCreateJob).toHaveBeenCalledWith(expect.objectContaining({ jobType: 'sync_akeneo.first_import' }), scope)
    expect(getSyncQueue).toHaveBeenCalledWith(AKENEO_FIRST_IMPORT_QUEUE)
    expect(mockEnqueue).toHaveBeenCalledWith({ progressJobId: 'sequence-job-1', scope })
  })
})
