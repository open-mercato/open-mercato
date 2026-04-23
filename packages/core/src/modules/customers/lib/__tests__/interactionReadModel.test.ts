import { normalizeCustomFieldResponse } from '@open-mercato/shared/lib/custom-fields/normalize'

describe('InteractionRecord.customValues normalization contract', () => {
  // `hydrateCanonicalInteractions` assigns `customValues` via
  // `normalizeCustomFieldResponse(customFieldValues[interactionId]) ?? null`.
  // These tests lock in the expected contract so a future regression in the
  // helper or an accidental re-introduction of `cf_`-prefixed keys cannot
  // silently break every downstream consumer (UI hooks, todo/interaction
  // compatibility helpers, example-customers-sync outbound worker).

  it('strips the `cf_` prefix produced by loadCustomFieldValues', () => {
    const result = normalizeCustomFieldResponse({
      cf_severity: 'critical',
      cf_priority: 3,
      cf_description: 'Follow up',
    })
    expect(result).toEqual({
      severity: 'critical',
      priority: 3,
      description: 'Follow up',
    })
  })

  it('strips the alternative `cf:` prefix', () => {
    const result = normalizeCustomFieldResponse({
      'cf:severity': 'high',
      'cf:priority': 5,
    })
    expect(result).toEqual({
      severity: 'high',
      priority: 5,
    })
  })

  it('keeps the example-customers-sync contract: cf_severity from the read model arrives as interaction.customValues.severity', () => {
    const raw = { cf_severity: 'critical', cf_priority: 3, cf_description: 'Follow up with procurement' }
    const normalized = normalizeCustomFieldResponse(raw)
    expect(normalized?.severity).toBe('critical')
    expect(normalized?.priority).toBe(3)
    expect(normalized?.description).toBe('Follow up with procurement')
  })

  it('returns undefined for empty/missing input so the read model can coalesce to null', () => {
    expect(normalizeCustomFieldResponse(null)).toBeUndefined()
    expect(normalizeCustomFieldResponse(undefined)).toBeUndefined()
    expect(normalizeCustomFieldResponse({})).toBeUndefined()
  })
})
