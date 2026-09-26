import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { SAUDI_STANDARD_VAT_RATE } from '../saudi/vat'
import {
  SAUDI_VAT_SETTINGS_DEFAULTS,
  SAUDI_VAT_SETTINGS_KEY,
  SAUDI_VAT_SETTINGS_MODULE_ID,
  isSaudiVatSettingsComplete,
  mergeSaudiVatSettings,
  parseSaudiVatSettingsInput,
  readSaudiVatSettings,
  readSaudiVatSettingsRecord,
  writeSaudiVatSettings,
} from '../vat-settings'

const VALID_INPUT = {
  sellerName: 'Apex Trading Est.',
  vatRegistrationNumber: '300000000000003',
  commercialRegistrationNumber: '1010101010',
  vatRate: 0.15,
  invoiceQrEnabled: true,
}

type Call = { kind: 'get' | 'set'; moduleId: string; name: string; value?: unknown; scope?: unknown }

const STORED_UPDATED_AT = '2026-01-31T09:15:00.000Z'
const WRITTEN_UPDATED_AT = '2026-02-01T10:00:00.000Z'

function fakeConfigService(seed: unknown = null) {
  const calls: Call[] = []
  const service = {
    getRecord: async (moduleId: string, name: string, scope?: unknown) => {
      calls.push({ kind: 'get', moduleId, name, scope })
      if (seed === null) return null
      return { moduleId, name, value: seed, tenantId: null, organizationId: null, source: 'tenant', createdAt: STORED_UPDATED_AT, updatedAt: STORED_UPDATED_AT }
    },
    setValue: async (moduleId: string, name: string, value: unknown, scope?: unknown) => {
      calls.push({ kind: 'set', moduleId, name, value, scope })
      return { moduleId, name, value, tenantId: null, organizationId: null, source: 'tenant', createdAt: WRITTEN_UPDATED_AT, updatedAt: WRITTEN_UPDATED_AT }
    },
  } as unknown as ModuleConfigService
  return { service, calls }
}

describe('mergeSaudiVatSettings', () => {
  it('returns the shipped defaults for a missing or malformed row', () => {
    expect(mergeSaudiVatSettings(null)).toEqual(SAUDI_VAT_SETTINGS_DEFAULTS)
    expect(mergeSaudiVatSettings('garbage')).toEqual(SAUDI_VAT_SETTINGS_DEFAULTS)
    expect(mergeSaudiVatSettings({ vatRate: 'high' })).toEqual(SAUDI_VAT_SETTINGS_DEFAULTS)
  })

  it('keeps stored values and fills the gaps', () => {
    expect(mergeSaudiVatSettings({ sellerName: 'Apex', vatRegistrationNumber: '300000000000003' })).toEqual({
      ...SAUDI_VAT_SETTINGS_DEFAULTS,
      sellerName: 'Apex',
      vatRegistrationNumber: '300000000000003',
    })
  })

  it('honours a historical rate instead of the current standard one', () => {
    expect(mergeSaudiVatSettings({ vatRate: 0.05 }).vatRate).toBe(0.05)
    expect(SAUDI_VAT_SETTINGS_DEFAULTS.vatRate).toBe(SAUDI_STANDARD_VAT_RATE)
  })
})

describe('isSaudiVatSettingsComplete', () => {
  it('requires a seller name and a valid VAT number', () => {
    expect(isSaudiVatSettingsComplete(mergeSaudiVatSettings(VALID_INPUT))).toBe(true)
    expect(isSaudiVatSettingsComplete(mergeSaudiVatSettings({ ...VALID_INPUT, sellerName: '   ' }))).toBe(false)
    expect(isSaudiVatSettingsComplete(mergeSaudiVatSettings({ ...VALID_INPUT, vatRegistrationNumber: '123' }))).toBe(false)
  })
})

describe('readSaudiVatSettings', () => {
  it('reads the tenant scope, merges the defaults and exposes the version', async () => {
    const { service, calls } = fakeConfigService({ sellerName: 'Apex' })

    const record = await readSaudiVatSettingsRecord(service, { tenantId: 'tenant-1' })

    expect(record.settings.sellerName).toBe('Apex')
    expect(record.settings.vatRate).toBe(SAUDI_STANDARD_VAT_RATE)
    expect(record.updatedAt).toBe(STORED_UPDATED_AT)
    expect(calls[0]).toEqual({
      kind: 'get',
      moduleId: SAUDI_VAT_SETTINGS_MODULE_ID,
      name: SAUDI_VAT_SETTINGS_KEY,
      scope: { tenantId: 'tenant-1' },
    })
  })

  it('reports no version before the first write', async () => {
    const { service } = fakeConfigService(null)

    const record = await readSaudiVatSettingsRecord(service, { tenantId: 'tenant-1' })

    expect(record).toEqual({ settings: SAUDI_VAT_SETTINGS_DEFAULTS, updatedAt: null })
    await expect(readSaudiVatSettings(service, { tenantId: 'tenant-1' })).resolves.toEqual(SAUDI_VAT_SETTINGS_DEFAULTS)
  })
})

describe('writeSaudiVatSettings', () => {
  it('normalizes the input, writes it under the tenant scope and returns the new version', async () => {
    const { service, calls } = fakeConfigService()
    const input = parseSaudiVatSettingsInput({
      ...VALID_INPUT,
      sellerName: '  Apex Trading Est.  ',
      vatRegistrationNumber: ' 300000000000003 ',
    })

    const record = await writeSaudiVatSettings(service, input, { tenantId: 'tenant-1' })

    expect(record.settings.sellerName).toBe('Apex Trading Est.')
    expect(record.settings.vatRegistrationNumber).toBe('300000000000003')
    expect(record.updatedAt).toBe(WRITTEN_UPDATED_AT)
    expect(calls[0]).toEqual({
      kind: 'set',
      moduleId: SAUDI_VAT_SETTINGS_MODULE_ID,
      name: SAUDI_VAT_SETTINGS_KEY,
      value: record.settings,
      scope: { tenantId: 'tenant-1' },
    })
  })
})

describe('parseSaudiVatSettingsInput', () => {
  it('applies the standard rate and the QR default', () => {
    const parsed = parseSaudiVatSettingsInput({ sellerName: 'Apex', vatRegistrationNumber: '300000000000003' })

    expect(parsed.vatRate).toBe(SAUDI_STANDARD_VAT_RATE)
    expect(parsed.invoiceQrEnabled).toBe(true)
    expect(parsed.commercialRegistrationNumber).toBeNull()
  })

  it('accepts an Arabic seller name up to the byte limit and rejects one past it', () => {
    const withinLimit = 'ا'.repeat(127)

    expect(parseSaudiVatSettingsInput({ sellerName: withinLimit, vatRegistrationNumber: '300000000000003' }).sellerName).toHaveLength(127)
    expect(() => parseSaudiVatSettingsInput({ sellerName: 'ا'.repeat(128), vatRegistrationNumber: '300000000000003' })).toThrow()
  })

  it('rejects an invalid VAT number, an empty seller name and a bad rate', () => {
    expect(() => parseSaudiVatSettingsInput({ sellerName: 'Apex', vatRegistrationNumber: '123' })).toThrow()
    expect(() => parseSaudiVatSettingsInput({ sellerName: '   ', vatRegistrationNumber: '300000000000003' })).toThrow()
    expect(() => parseSaudiVatSettingsInput({ ...VALID_INPUT, vatRate: 2 })).toThrow()
  })
})
