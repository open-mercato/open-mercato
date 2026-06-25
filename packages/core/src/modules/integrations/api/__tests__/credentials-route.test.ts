/** @jest-environment node */

import type { IntegrationCredentialsSchema } from '@open-mercato/shared/modules/integrations/types'

import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getIntegration } from '@open-mercato/shared/modules/integrations/types'
import { emitIntegrationsEvent } from '../../events'
import {
  resolveUserFeatures,
  runIntegrationMutationGuardAfterSuccess,
  runIntegrationMutationGuards,
} from '../guards'
import { PUT } from '../[id]/credentials/route'

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

const akeneoSchema: IntegrationCredentialsSchema = {
  fields: [
    { key: 'apiUrl', label: 'Akeneo URL', type: 'url', required: true },
    { key: 'clientId', label: 'Client ID', type: 'text', required: true },
  ],
}

function buildRequest(credentials: Record<string, unknown>): Request {
  return new Request('http://localhost/api/integrations/sync_akeneo/credentials', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ credentials }),
  })
}

describe('integrations credentials PUT route — URL validation', () => {
  const saveMock = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    saveMock.mockReset()
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ tenantId: 't1', orgId: 'o1', sub: 'u1' })
    ;(getIntegration as jest.Mock).mockReturnValue({ id: 'sync_akeneo', title: 'Akeneo PIM' })
    ;(runIntegrationMutationGuards as jest.Mock).mockResolvedValue({ ok: true })
    ;(createRequestContainer as jest.Mock).mockResolvedValue({
      resolve: (key: string) => {
        if (key === 'integrationCredentialsService') {
          return { getSchema: () => akeneoSchema, save: saveMock, resolveUpdatedAt: jest.fn().mockResolvedValue(null) }
        }
        throw new Error(`unexpected resolve(${key})`)
      },
    })
  })

  it('rejects a script fragment in a url field with 422 and does not persist', async () => {
    const response = await PUT(buildRequest({ apiUrl: '<script>alert(1)</script>', clientId: 'abc' }), {
      params: { id: 'sync_akeneo' },
    })
    expect(response.status).toBe(422)
    const body = await response.json()
    expect(body.details.fieldErrors.apiUrl).toBe('Akeneo URL must be a valid http(s) URL.')
    expect(saveMock).not.toHaveBeenCalled()
    expect(emitIntegrationsEvent).not.toHaveBeenCalled()
  })

  it('rejects a malformed url with embedded markup', async () => {
    const response = await PUT(
      buildRequest({ apiUrl: 'http://example.com<script>alert(1)</script>', clientId: 'abc' }),
      { params: { id: 'sync_akeneo' } },
    )
    expect(response.status).toBe(422)
    expect(saveMock).not.toHaveBeenCalled()
  })

  it('persists a valid http(s) url', async () => {
    const response = await PUT(
      buildRequest({ apiUrl: 'https://your-instance.cloud.akeneo.com', clientId: 'abc' }),
      { params: { id: 'sync_akeneo' } },
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({ ok: true })
    expect(saveMock).toHaveBeenCalledWith(
      'sync_akeneo',
      { apiUrl: 'https://your-instance.cloud.akeneo.com', clientId: 'abc' },
      { organizationId: 'o1', tenantId: 't1' },
    )
    expect(runIntegrationMutationGuardAfterSuccess).toHaveBeenCalled()
  })
})
