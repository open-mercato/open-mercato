const mockIsEnabled = jest.fn()
const mockCreateIntegrationStateService = jest.fn((_em: unknown) => ({ isEnabled: mockIsEnabled }))

jest.mock('@open-mercato/core/modules/integrations/lib/state-service', () => ({
  createIntegrationStateService: (em: unknown) => mockCreateIntegrationStateService(em),
}))

import type { EntityManager } from '@mikro-orm/postgresql'
import { getEntityIds, registerEntityIds, type EntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { isWebhookIntegrationEnabled } from '../integration-state'
import { webhookCustomIntegrationId } from '../../integration'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

function createUntouchableEm(): EntityManager {
  return new Proxy({}, {
    get: (_target, property) => {
      throw new Error(`[internal] em.${String(property)} must not be used`)
    },
  }) as EntityManager
}

describe('isWebhookIntegrationEnabled', () => {
  let previousEntityIds: EntityIds | null = null

  beforeEach(() => {
    previousEntityIds = getEntityIds(false)
    mockIsEnabled.mockReset()
    mockCreateIntegrationStateService.mockClear()
  })

  afterEach(() => {
    registerEntityIds(previousEntityIds ?? ({} as EntityIds))
    previousEntityIds = null
  })

  it('returns the definition default without touching em when the integrations module is disabled', async () => {
    registerEntityIds({ webhooks: { webhook_entity: 'webhooks:webhook_entity' } })

    await expect(isWebhookIntegrationEnabled(createUntouchableEm(), scope)).resolves.toBe(true)
    expect(mockCreateIntegrationStateService).not.toHaveBeenCalled()
  })

  it('delegates to the integration state service when the integrations module is enabled', async () => {
    registerEntityIds({ integrations: { integration_state: 'integrations:integration_state' } })
    mockIsEnabled.mockResolvedValue(true)
    const em = {} as EntityManager

    await expect(isWebhookIntegrationEnabled(em, scope)).resolves.toBe(true)
    expect(mockCreateIntegrationStateService).toHaveBeenCalledWith(em)
    expect(mockIsEnabled).toHaveBeenCalledWith(webhookCustomIntegrationId, scope)
  })

  it('returns false when the integrations module is enabled and the webhook integration is disabled', async () => {
    registerEntityIds({ integrations: { integration_state: 'integrations:integration_state' } })
    mockIsEnabled.mockResolvedValue(false)

    await expect(isWebhookIntegrationEnabled({} as EntityManager, scope)).resolves.toBe(false)
    expect(mockIsEnabled).toHaveBeenCalledTimes(1)
  })
})
