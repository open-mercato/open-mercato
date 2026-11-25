import { normalizeCustomFieldResponse } from '@open-mercato/shared/lib/custom-fields/normalize'
import { mapInteractionRecordToActivitySummary } from '../interactionCompatibility'

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

describe('activity compatibility body format', () => {
  it.each(['markdown', 'text', null] as const)('carries the raw body and format %s', (bodyFormat) => {
    const body = 'Follow up&#x20;'
    const summary = mapInteractionRecordToActivitySummary({
      id: 'interaction-id',
      interactionType: 'note',
      status: 'done',
      entityId: 'customer-id',
      createdAt: '2026-11-25T00:00:00.000Z',
      body,
      bodyFormat,
    })

    expect(summary).toMatchObject({ body, bodyFormat })
  })
})
