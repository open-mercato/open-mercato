import { DEFAULT_SETTINGS, hydrateWarrantyClaimsQueueSettings } from '../config'

describe('warranty_claims claims-queue widget config', () => {
  it('returns defaults for empty input', () => {
    expect(hydrateWarrantyClaimsQueueSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(hydrateWarrantyClaimsQueueSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(hydrateWarrantyClaimsQueueSettings('invalid')).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps an explicit opt-out of the status breakdown', () => {
    expect(hydrateWarrantyClaimsQueueSettings({ showStatusBreakdown: false })).toEqual({
      showStatusBreakdown: false,
    })
  })

  it('falls back to the default for non-boolean values', () => {
    expect(hydrateWarrantyClaimsQueueSettings({ showStatusBreakdown: 'nope' as never })).toEqual(DEFAULT_SETTINGS)
    expect(hydrateWarrantyClaimsQueueSettings({})).toEqual(DEFAULT_SETTINGS)
  })
})
