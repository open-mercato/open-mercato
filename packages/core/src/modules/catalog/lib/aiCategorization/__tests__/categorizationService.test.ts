import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { createCatalogCategorizationService } from '../categorizationService'
import type { CatalogDecisionModelPort } from '../decisionModelPort'
import { AI_CATEGORIZATION_SETTINGS_DEFAULT } from '../../aiCategorizationSettings'

const TENANT = '11111111-1111-4111-8111-111111111111'

function createConfigService(storedSettings: unknown): ModuleConfigService {
  return {
    async getRecord() {
      return null
    },
    async getValue<T>(_moduleId: string, _name: string, options?: { defaultValue?: T | null }) {
      return (storedSettings === undefined ? (options?.defaultValue ?? null) : (storedSettings as T))
    },
    async setValue() {
      return null
    },
    async restoreDefaults() {},
    async invalidate() {},
  }
}

function createPort(availability: ReturnType<CatalogDecisionModelPort['getAvailability']>): CatalogDecisionModelPort {
  return {
    getAvailability: () => availability,
    async decide() {
      throw new Error('[internal] not used in this test')
    },
  }
}

describe('catalogCategorizationService.getStatus', () => {
  it('returns not_installed when the decision model port cannot be resolved', async () => {
    const service = createCatalogCategorizationService({
      configService: createConfigService(undefined),
      decisionModelPort: null,
    })
    const status = await service.getStatus({ tenantId: TENANT })
    expect(status).toEqual({
      available: false,
      reason: 'not_installed',
      enabled: false,
      effective: false,
      settings: AI_CATEGORIZATION_SETTINGS_DEFAULT,
    })
  })

  it.each(['not_configured', 'unknown_provider', 'credentials_missing', 'model_missing', 'fixture_disabled'])(
    'propagates the port unavailable reason %s',
    async (reason) => {
      const service = createCatalogCategorizationService({
        configService: createConfigService(undefined),
        decisionModelPort: createPort({ available: false, reason }),
      })
      const status = await service.getStatus({ tenantId: TENANT })
      expect(status.available).toBe(false)
      expect(status.reason).toBe(reason)
      expect(status.effective).toBe(false)
    },
  )

  it('is not effective when available but the tenant setting is disabled', async () => {
    const service = createCatalogCategorizationService({
      configService: createConfigService(undefined),
      decisionModelPort: createPort({ available: true, provider: 'openrouter', model: 'jev' }),
    })
    const status = await service.getStatus({ tenantId: TENANT })
    expect(status.available).toBe(true)
    expect(status.enabled).toBe(false)
    expect(status.effective).toBe(false)
  })

  it('is not effective when enabled but the port is unavailable', async () => {
    const service = createCatalogCategorizationService({
      configService: createConfigService({ ...AI_CATEGORIZATION_SETTINGS_DEFAULT, enabled: true }),
      decisionModelPort: createPort({ available: false, reason: 'credentials_missing' }),
    })
    const status = await service.getStatus({ tenantId: TENANT })
    expect(status.enabled).toBe(true)
    expect(status.available).toBe(false)
    expect(status.effective).toBe(false)
  })

  it('is effective when available and enabled', async () => {
    const service = createCatalogCategorizationService({
      configService: createConfigService({ ...AI_CATEGORIZATION_SETTINGS_DEFAULT, enabled: true }),
      decisionModelPort: createPort({ available: true, provider: 'openrouter', model: 'jev' }),
    })
    const status = await service.getStatus({ tenantId: TENANT })
    expect(status.effective).toBe(true)
  })
})
