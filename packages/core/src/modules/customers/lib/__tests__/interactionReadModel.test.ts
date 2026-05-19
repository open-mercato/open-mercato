import { normalizeCustomFieldResponse } from '@open-mercato/shared/lib/custom-fields/normalize'

describe('InteractionRecord.customValues normalization contract', () => {
  it('strips the cf_ prefix produced by loadCustomFieldValues', () => {
    expect(normalizeCustomFieldResponse({
      cf_severity: 'critical',
      cf_priority: 3,
      cf_description: 'Follow up',
    })).toEqual({
      severity: 'critical',
      priority: 3,
      description: 'Follow up',
    })
  })

  it('strips the alternative cf: prefix', () => {
    expect(normalizeCustomFieldResponse({
      'cf:severity': 'high',
      'cf:priority': 5,
    })).toEqual({
      severity: 'high',
      priority: 5,
    })
  })

  it('keeps example customer sync custom values unprefixed', () => {
    const normalized = normalizeCustomFieldResponse({
      cf_severity: 'critical',
      cf_priority: 3,
      cf_description: 'Follow up with procurement',
    })

    expect(normalized?.severity).toBe('critical')
    expect(normalized?.priority).toBe(3)
    expect(normalized?.description).toBe('Follow up with procurement')
  })

  it('returns undefined for empty or missing input', () => {
    expect(normalizeCustomFieldResponse(null)).toBeUndefined()
    expect(normalizeCustomFieldResponse(undefined)).toBeUndefined()
    expect(normalizeCustomFieldResponse({})).toBeUndefined()
  })
})
