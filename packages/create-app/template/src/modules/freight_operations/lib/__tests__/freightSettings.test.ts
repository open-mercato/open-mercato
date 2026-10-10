/** @jest-environment node */
import { FREIGHT_SETTINGS_DEFAULTS, mergeFreightSettings } from '../freightSettings'

describe('mergeFreightSettings', () => {
  it('falls back to the shipped defaults for absent or malformed values', () => {
    expect(mergeFreightSettings(undefined)).toEqual(FREIGHT_SETTINGS_DEFAULTS)
    expect(mergeFreightSettings('nonsense')).toEqual(FREIGHT_SETTINGS_DEFAULTS)
    expect(mergeFreightSettings({ defaultPaymentTermsDays: 'soon' })).toEqual(FREIGHT_SETTINGS_DEFAULTS)
  })

  it('merges stored values over the defaults field by field', () => {
    const merged = mergeFreightSettings({
      defaultRequiresCustomerApproval: false,
      defaultPaymentTermsDays: 45,
      orderNumberPrefix: 'KSA',
      salesChannelId: '5c2f7dc0-4a0e-4a4f-a63f-9a73572f3f6a',
    })
    expect(merged.defaultRequiresCustomerApproval).toBe(false)
    expect(merged.defaultPaymentTermsDays).toBe(45)
    expect(merged.orderNumberPrefix).toBe('KSA')
    expect(merged.salesChannelId).toBe('5c2f7dc0-4a0e-4a4f-a63f-9a73572f3f6a')
    expect(merged.defaultVatRate).toBe(FREIGHT_SETTINGS_DEFAULTS.defaultVatRate)
  })

  it('rejects a VAT rate outside the fraction range instead of storing a percent as a fraction', () => {
    const merged = mergeFreightSettings({ defaultVatRate: 15 })
    expect(merged.defaultVatRate).toBe(FREIGHT_SETTINGS_DEFAULTS.defaultVatRate)
  })

  it('treats the defaults as approval-required', () => {
    expect(FREIGHT_SETTINGS_DEFAULTS.defaultRequiresCustomerApproval).toBe(true)
    expect(FREIGHT_SETTINGS_DEFAULTS.requirePodForBilling).toBe(false)
  })
})
