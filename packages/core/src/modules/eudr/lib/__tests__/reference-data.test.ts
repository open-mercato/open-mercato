import {
  EUDR_RISK_CRITERIA_KEYS,
  getCountryRiskTier,
  suggestCommodityForHsCode,
} from '../reference-data'

describe('getCountryRiskTier', () => {
  it('returns high, low, standard, and unknown tiers from normalized country codes', () => {
    expect(getCountryRiskTier('ru')).toBe('high')
    expect(getCountryRiskTier('pl')).toBe('low')
    expect(getCountryRiskTier('BR')).toBe('standard')
    expect(getCountryRiskTier('')).toBe('unknown')
    expect(getCountryRiskTier('POL')).toBe('unknown')
    expect(getCountryRiskTier(null)).toBe('unknown')
    // Implementing Regulation (EU) 2025/1093 list (corroborated 2026-07):
    expect(getCountryRiskTier('NO')).toBe('low')
    expect(getCountryRiskTier('KR')).toBe('low')
    expect(getCountryRiskTier('IL')).toBe('standard')
    expect(getCountryRiskTier('CD')).toBe('standard')
    expect(getCountryRiskTier('CG')).toBe('low')
  })
})

describe('suggestCommodityForHsCode', () => {
  it('uses digits-only longest-prefix matching', () => {
    expect(suggestCommodityForHsCode('HS 0901.21')).toBe('coffee')
    expect(suggestCommodityForHsCode('4403 99')).toBe('wood')
    expect(suggestCommodityForHsCode('4011')).toBe('rubber')
  })

  it('returns null when no Annex-I suggestion matches', () => {
    expect(suggestCommodityForHsCode('9999')).toBeNull()
    expect(suggestCommodityForHsCode(null)).toBeNull()
  })
})

describe('EUDR_RISK_CRITERIA_KEYS', () => {
  it('flattens the Art. 10 criteria catalog', () => {
    expect(EUDR_RISK_CRITERIA_KEYS).toContain('deforestation_trend')
    expect(EUDR_RISK_CRITERIA_KEYS).toContain('supplier_transparency')
    expect(new Set(EUDR_RISK_CRITERIA_KEYS).size).toBe(EUDR_RISK_CRITERIA_KEYS.length)
  })
})
