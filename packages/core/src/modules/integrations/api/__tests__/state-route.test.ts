/** @jest-environment node */

import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  clearRegisteredIntegrations,
  registerIntegration,
} from '@open-mercato/shared/modules/integrations/types'
import { emitIntegrationsEvent } from '../../events'
import { createIntegrationStateService } from '../../lib/state-service'
import { runIntegrationMutationGuards } from '../guards'
import { PUT } from '../[id]/state/route'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

jest.mock('../../events', () => ({
  emitIntegrationsEvent: jest.fn(),
}))

jest.mock('../guards', () => ({
  resolveUserFeatures: jest.fn(() => []),
  runIntegrationMutationGuards: jest.fn(),
  runIntegrationMutationGuardAfterSuccess: jest.fn(),
}))

const integrationId = 'default_enabled_integration'

describe('integrations state PUT route — missing state row', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    clearRegisteredIntegrations()
    registerIntegration({ id: integrationId, title: 'Default enabled', defaultState: { isEnabled: true } })
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ tenantId: 't1', orgId: 'o1', sub: 'u1' })
    ;(runIntegrationMutationGuards as jest.Mock).mockResolvedValue({ ok: true })
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(null)
  })

  afterEach(() => {
    clearRegisteredIntegrations()
  })

  it('keeps a default-enabled integration enabled when only reauthRequired is written', async () => {
    const em = {
      create: jest.fn((_Entity: unknown, data: Record<string, unknown>) => ({ ...data })),
      persist: jest.fn(() => em),
      flush: jest.fn(async () => undefined),
    }
    const stateService = createIntegrationStateService(em as never)
    ;(createRequestContainer as jest.Mock).mockResolvedValue({
      resolve: (key: string) => {
        if (key === 'integrationStateService') return stateService
        throw new Error(`unexpected resolve(${key})`)
      },
    })

    const response = await PUT(
      new Request(`http://localhost/api/integrations/${integrationId}/state`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reauthRequired: true }),
      }),
      { params: { id: integrationId } },
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.isEnabled).toBe(true)
    expect(body.reauthRequired).toBe(true)
    expect(em.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ integrationId, isEnabled: true, reauthRequired: true }),
    )
    expect(emitIntegrationsEvent).toHaveBeenCalledWith(
      'integrations.state.updated',
      expect.objectContaining({ integrationId, isEnabled: true, reauthRequired: true }),
    )
  })
})
