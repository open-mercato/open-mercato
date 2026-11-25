import { resolveDictionaryLabel } from '../components/useDealMergeLookups'
import { DEAL_STATUS_DEFAULTS, ENTITY_SOURCE_DEFAULTS, PIPELINE_STAGE_DEFAULTS } from '../../../../../lib/dictionaryDefaults'

describe('resolveDictionaryLabel', () => {
  it('prefers the tenant dictionary label', () => {
    const map = { in_progress: { label: 'W toku' } }
    expect(resolveDictionaryLabel(map, DEAL_STATUS_DEFAULTS, 'in_progress')).toBe('W toku')
  })

  it('falls back to the default status label when the dictionary has no entry', () => {
    expect(resolveDictionaryLabel({}, DEAL_STATUS_DEFAULTS, 'in_progress')).toBe('In progress')
    expect(resolveDictionaryLabel(undefined, DEAL_STATUS_DEFAULTS, 'in_progress')).toBe('In progress')
  })

  it('falls back to the default pipeline stage label', () => {
    expect(resolveDictionaryLabel({}, PIPELINE_STAGE_DEFAULTS, 'sales_qualified_lead')).toBe('Sales Qualified Lead')
  })

  it('falls back to the default source label', () => {
    expect(resolveDictionaryLabel({}, ENTITY_SOURCE_DEFAULTS, 'customer_referral')).toBe('Customer referral')
    expect(resolveDictionaryLabel({}, ENTITY_SOURCE_DEFAULTS, 'partner_referral')).toBe('Partner referral')
  })

  it('returns null for unknown values so callers can show the raw value', () => {
    expect(resolveDictionaryLabel({}, PIPELINE_STAGE_DEFAULTS, 'custom_stage')).toBeNull()
  })
})
