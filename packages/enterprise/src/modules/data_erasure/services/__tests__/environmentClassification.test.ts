import { requireNonProductionEnvironment } from '../environmentClassification'

describe('requireNonProductionEnvironment', () => {
  it('accepts an explicit sandbox classification', () => {
    expect(requireNonProductionEnvironment({ OM_ENVIRONMENT_CLASSIFICATION: 'sandbox' })).toBe('sandbox')
  })

  it('rejects an unclassified deployment', () => {
    expect(() => requireNonProductionEnvironment({})).toThrow('must explicitly identify')
  })

  it('rejects production', () => {
    expect(() => requireNonProductionEnvironment({
      OM_ENVIRONMENT_CLASSIFICATION: 'production',
    })).toThrow('disabled on production')
  })
})
