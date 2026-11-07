import type { ModuleConfigService, ModuleConfigRecord } from '@open-mercato/core/modules/configs/lib/module-config-service'
import {
  AI_CATEGORIZATION_SETTINGS_DEFAULT,
  readAiCategorizationSettings,
  writeAiCategorizationSettings,
} from '../aiCategorizationSettings'
import { AI_CATEGORIZATION_CONFIG_NAME, CATALOG_SETTINGS_MODULE_ID } from '../settings'

const TENANT = '11111111-1111-4111-8111-111111111111'

function createConfigService(initialValue: unknown): ModuleConfigService & { setCalls: Array<{ value: unknown; scope?: { tenantId?: string | null } }> } {
  let stored = initialValue
  const setCalls: Array<{ value: unknown; scope?: { tenantId?: string | null } }> = []
  return {
    setCalls,
    async getRecord() {
      return null
    },
    async getValue<T>(_moduleId: string, _name: string, options?: { defaultValue?: T | null }) {
      return (stored === undefined ? (options?.defaultValue ?? null) : (stored as T))
    },
    async setValue(moduleId, name, value, scope) {
      stored = value
      setCalls.push({ value, scope })
      return {
        moduleId,
        name,
        value,
        tenantId: scope?.tenantId ?? null,
        organizationId: scope?.organizationId ?? null,
        source: scope?.tenantId ? 'tenant' : 'instance',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } satisfies ModuleConfigRecord
    },
    async restoreDefaults() {},
    async invalidate() {},
  }
}

describe('aiCategorizationSettings', () => {
  it('returns defaults (off) when no row exists', async () => {
    const service = createConfigService(undefined)
    const settings = await readAiCategorizationSettings(service, { tenantId: TENANT })
    expect(settings).toEqual(AI_CATEGORIZATION_SETTINGS_DEFAULT)
    expect(settings.enabled).toBe(false)
  })

  it('returns defaults (off) when the stored row fails schema validation', async () => {
    const service = createConfigService({ enabled: 'not-a-boolean', applyMode: 'bogus' })
    const settings = await readAiCategorizationSettings(service, { tenantId: TENANT })
    expect(settings).toEqual(AI_CATEGORIZATION_SETTINGS_DEFAULT)
  })

  it('round-trips a valid settings row through write then read', async () => {
    const service = createConfigService(undefined)
    await writeAiCategorizationSettings(service, { tenantId: TENANT }, {
      enabled: true,
      applyMode: 'auto_apply',
      autoApplyThreshold: 0.9,
      autoSuggestOnCreate: true,
    })
    expect(service.setCalls).toHaveLength(1)
    expect(service.setCalls[0].scope?.tenantId).toBe(TENANT)
    const settings = await readAiCategorizationSettings(service, { tenantId: TENANT })
    expect(settings).toEqual({
      enabled: true,
      applyMode: 'auto_apply',
      autoApplyThreshold: 0.9,
      autoSuggestOnCreate: true,
    })
  })

  it('writes through the catalog module id and the fixed config name', async () => {
    const service = createConfigService(undefined)
    const spy = jest.spyOn(service, 'setValue')
    await writeAiCategorizationSettings(service, { tenantId: TENANT }, AI_CATEGORIZATION_SETTINGS_DEFAULT)
    expect(spy).toHaveBeenCalledWith(
      CATALOG_SETTINGS_MODULE_ID,
      AI_CATEGORIZATION_CONFIG_NAME,
      AI_CATEGORIZATION_SETTINGS_DEFAULT,
      { tenantId: TENANT },
    )
  })
})
