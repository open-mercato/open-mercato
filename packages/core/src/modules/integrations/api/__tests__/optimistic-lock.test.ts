/** @jest-environment node */

import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getIntegration } from '@open-mercato/shared/modules/integrations/types'
import {
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  OPTIMISTIC_LOCK_HEADER_NAME,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { emitIntegrationsEvent } from '../../events'
import {
  resolveUserFeatures,
  runIntegrationMutationGuardAfterSuccess,
  runIntegrationMutationGuards,
} from '../guards'
import { PUT as putState } from '../[id]/state/route'
import { PUT as putVersion } from '../[id]/version/route'
import { PUT as putCredentials } from '../[id]/credentials/route'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/modules/integrations/types', () => ({
  ...jest.requireActual('@open-mercato/shared/modules/integrations/types'),
  getIntegration: jest.fn(),
}))

jest.mock('../../events', () => ({
  emitIntegrationsEvent: jest.fn(),
}))

jest.mock('../guards', () => ({
  resolveUserFeatures: jest.fn(() => []),
  runIntegrationMutationGuards: jest.fn(),
  runIntegrationMutationGuardAfterSuccess: jest.fn(),
}))

const CURRENT_VERSION = '2026-06-19T00:00:00.000Z'
const STALE_VERSION = '2026-06-18T00:00:00.000Z'

function buildRequest(url: string, body: Record<string, unknown>, expectedVersion?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (expectedVersion) headers[OPTIMISTIC_LOCK_HEADER_NAME] = expectedVersion
  return new Request(url, { method: 'PUT', headers, body: JSON.stringify(body) })
}

describe('integrations write routes — optimistic-lock enforcement', () => {
  const stateUpsert = jest.fn()
  const credentialsSave = jest.fn()

  function buildStateService(updatedAtIso: string) {
    return {
      resolveState: jest.fn().mockResolvedValue({
        isEnabled: false,
        apiVersion: 'v1',
        reauthRequired: false,
        lastHealthStatus: null,
        lastHealthCheckedAt: null,
        lastHealthLatencyMs: null,
        enabledAt: null,
        updatedAt: new Date(updatedAtIso),
      }),
      upsert: stateUpsert.mockResolvedValue({
        isEnabled: true,
        reauthRequired: false,
        apiVersion: 'v1',
        updatedAt: new Date(CURRENT_VERSION),
      }),
    }
  }

  function buildCredentialsService(updatedAtIso: string | null) {
    return {
      resolveUpdatedAt: jest.fn().mockResolvedValue(updatedAtIso ? new Date(updatedAtIso) : null),
      getSchema: () => ({ fields: [] }),
      save: credentialsSave.mockResolvedValue(undefined),
    }
  }

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.OM_OPTIMISTIC_LOCK = 'all'
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ tenantId: 't1', orgId: 'o1', sub: 'u1' })
    ;(runIntegrationMutationGuards as jest.Mock).mockResolvedValue({ ok: true })
  })

  describe('state PUT', () => {
    beforeEach(() => {
      ;(getIntegration as jest.Mock).mockReturnValue({ id: 'sync_akeneo', title: 'Akeneo' })
    })

    it('returns 409 conflict on a stale state version and does not upsert', async () => {
      ;(createRequestContainer as jest.Mock).mockResolvedValue({
        resolve: (key: string) => {
          if (key === 'integrationStateService') return buildStateService(CURRENT_VERSION)
          throw new Error(`unexpected resolve(${key})`)
        },
      })
      const res = await putState(
        buildRequest('http://localhost/api/integrations/sync_akeneo/state', { isEnabled: true }, STALE_VERSION),
        { params: { id: 'sync_akeneo' } },
      )
      expect(res.status).toBe(409)
      const body = await res.json()
      expect(body.code).toBe(OPTIMISTIC_LOCK_CONFLICT_CODE)
      expect(stateUpsert).not.toHaveBeenCalled()
      expect(emitIntegrationsEvent).not.toHaveBeenCalled()
    })

    it('upserts when the supplied state version matches', async () => {
      ;(createRequestContainer as jest.Mock).mockResolvedValue({
        resolve: (key: string) => {
          if (key === 'integrationStateService') return buildStateService(CURRENT_VERSION)
          throw new Error(`unexpected resolve(${key})`)
        },
      })
      const res = await putState(
        buildRequest('http://localhost/api/integrations/sync_akeneo/state', { isEnabled: true }, CURRENT_VERSION),
        { params: { id: 'sync_akeneo' } },
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.updatedAt).toBe(CURRENT_VERSION)
      expect(stateUpsert).toHaveBeenCalled()
      expect(runIntegrationMutationGuardAfterSuccess).toHaveBeenCalled()
    })

    it('upserts when no version header is supplied (strictly additive)', async () => {
      ;(createRequestContainer as jest.Mock).mockResolvedValue({
        resolve: (key: string) => {
          if (key === 'integrationStateService') return buildStateService(CURRENT_VERSION)
          throw new Error(`unexpected resolve(${key})`)
        },
      })
      const res = await putState(
        buildRequest('http://localhost/api/integrations/sync_akeneo/state', { isEnabled: true }),
        { params: { id: 'sync_akeneo' } },
      )
      expect(res.status).toBe(200)
      expect(stateUpsert).toHaveBeenCalled()
    })
  })

  describe('version PUT', () => {
    beforeEach(() => {
      ;(getIntegration as jest.Mock).mockReturnValue({
        id: 'sync_akeneo',
        title: 'Akeneo',
        apiVersions: [
          { id: 'v1', isDefault: true },
          { id: 'v2' },
        ],
      })
    })

    it('returns 409 conflict on a stale state version and does not upsert', async () => {
      ;(createRequestContainer as jest.Mock).mockResolvedValue({
        resolve: (key: string) => {
          if (key === 'integrationStateService') return buildStateService(CURRENT_VERSION)
          throw new Error(`unexpected resolve(${key})`)
        },
      })
      const res = await putVersion(
        buildRequest('http://localhost/api/integrations/sync_akeneo/version', { apiVersion: 'v2' }, STALE_VERSION),
        { params: { id: 'sync_akeneo' } },
      )
      expect(res.status).toBe(409)
      const body = await res.json()
      expect(body.code).toBe(OPTIMISTIC_LOCK_CONFLICT_CODE)
      expect(stateUpsert).not.toHaveBeenCalled()
      expect(emitIntegrationsEvent).not.toHaveBeenCalled()
    })

    it('changes the version when the supplied version matches', async () => {
      ;(createRequestContainer as jest.Mock).mockResolvedValue({
        resolve: (key: string) => {
          if (key === 'integrationStateService') return buildStateService(CURRENT_VERSION)
          throw new Error(`unexpected resolve(${key})`)
        },
      })
      const res = await putVersion(
        buildRequest('http://localhost/api/integrations/sync_akeneo/version', { apiVersion: 'v2' }, CURRENT_VERSION),
        { params: { id: 'sync_akeneo' } },
      )
      expect(res.status).toBe(200)
      expect(stateUpsert).toHaveBeenCalledWith('sync_akeneo', { apiVersion: 'v2' }, expect.anything())
    })
  })

  describe('credentials PUT', () => {
    beforeEach(() => {
      ;(getIntegration as jest.Mock).mockReturnValue({ id: 'sync_akeneo', title: 'Akeneo' })
    })

    it('returns 409 conflict on a stale credentials version and does not save', async () => {
      ;(createRequestContainer as jest.Mock).mockResolvedValue({
        resolve: (key: string) => {
          if (key === 'integrationCredentialsService') return buildCredentialsService(CURRENT_VERSION)
          throw new Error(`unexpected resolve(${key})`)
        },
      })
      const res = await putCredentials(
        buildRequest('http://localhost/api/integrations/sync_akeneo/credentials', { credentials: { token: 'x' } }, STALE_VERSION),
        { params: { id: 'sync_akeneo' } },
      )
      expect(res.status).toBe(409)
      const body = await res.json()
      expect(body.code).toBe(OPTIMISTIC_LOCK_CONFLICT_CODE)
      expect(credentialsSave).not.toHaveBeenCalled()
      expect(emitIntegrationsEvent).not.toHaveBeenCalled()
    })

    it('saves when the supplied credentials version matches', async () => {
      ;(createRequestContainer as jest.Mock).mockResolvedValue({
        resolve: (key: string) => {
          if (key === 'integrationCredentialsService') return buildCredentialsService(CURRENT_VERSION)
          throw new Error(`unexpected resolve(${key})`)
        },
      })
      const res = await putCredentials(
        buildRequest('http://localhost/api/integrations/sync_akeneo/credentials', { credentials: { token: 'x' } }, CURRENT_VERSION),
        { params: { id: 'sync_akeneo' } },
      )
      expect(res.status).toBe(200)
      expect(credentialsSave).toHaveBeenCalled()
    })

    it('saves a first-time credentials write when no row exists yet (no current version)', async () => {
      ;(createRequestContainer as jest.Mock).mockResolvedValue({
        resolve: (key: string) => {
          if (key === 'integrationCredentialsService') return buildCredentialsService(null)
          throw new Error(`unexpected resolve(${key})`)
        },
      })
      const res = await putCredentials(
        buildRequest('http://localhost/api/integrations/sync_akeneo/credentials', { credentials: { token: 'x' } }, STALE_VERSION),
        { params: { id: 'sync_akeneo' } },
      )
      expect(res.status).toBe(200)
      expect(credentialsSave).toHaveBeenCalled()
    })
  })
})
