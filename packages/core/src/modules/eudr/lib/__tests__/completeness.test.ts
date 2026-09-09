import {
  COMPLETENESS_DIMENSIONS,
  HARVEST_CUTOFF_DATE,
  computeHarvestCutoffWarning,
  computeSubmissionCompleteness,
} from '../completeness'

describe('computeSubmissionCompleteness', () => {
  it('returns zero with all dimensions missing for empty input', () => {
    expect(computeSubmissionCompleteness({})).toEqual({
      score: 0,
      missingFields: [...COMPLETENESS_DIMENSIONS],
    })
  })

  it('returns one hundred when all dimensions are met', () => {
    expect(computeSubmissionCompleteness({
      originCountry: 'PL',
      geolocation: { type: 'Feature', properties: {} },
      quantityKg: '12.5',
      harvestFrom: '2026-01-01',
      harvestTo: '2026-01-31',
      producerName: 'Producer Cooperative',
      attachmentIds: ['11111111-1111-4111-8111-111111111111'],
    })).toEqual({
      score: 100,
      missingFields: [],
    })
  })

  it('marks harvest period missing when harvestFrom is after harvestTo', () => {
    const result = computeSubmissionCompleteness({
      harvestFrom: '2026-02-01',
      harvestTo: '2026-01-01',
    })

    expect(result.missingFields).toContain('harvest_period')
  })

  it.each([0, -1, 'abc'])('marks quantity missing for invalid quantity %p', (quantityKg) => {
    const result = computeSubmissionCompleteness({ quantityKg })

    expect(result.missingFields).toContain('quantity')
  })

  it('marks geolocation missing for unsupported GeoJSON type', () => {
    const result = computeSubmissionCompleteness({
      geolocation: { type: 'LineString' },
    })

    expect(result.missingFields).toContain('geolocation')
  })

  it('marks documents missing for an empty attachment list', () => {
    const result = computeSubmissionCompleteness({
      attachmentIds: [],
    })

    expect(result.missingFields).toContain('documents')
  })

  it('marks geolocation complete when active plots are linked', () => {
    const result = computeSubmissionCompleteness({}, { activePlotCount: 2 })

    expect(result.missingFields).not.toContain('geolocation')
    expect(result.missingFields).toContain('documents')
  })

  it('marks documents complete when linked attachments exist outside attachmentIds', () => {
    const result = computeSubmissionCompleteness({ attachmentIds: [] }, { linkedAttachmentCount: 1 })

    expect(result.missingFields).not.toContain('documents')
    expect(result.missingFields).toContain('geolocation')
  })

  it('keeps plots and attachment dimensions missing when both context counts are absent', () => {
    const result = computeSubmissionCompleteness({
      attachmentIds: [],
      geolocation: null,
    })

    expect(result.missingFields).toContain('geolocation')
    expect(result.missingFields).toContain('documents')
  })

  it('scores three completed dimensions as fifty', () => {
    expect(computeSubmissionCompleteness({
      originCountry: 'DE',
      quantityKg: 42,
      producerName: 'Forest Supply GmbH',
    })).toEqual({
      score: 50,
      missingFields: ['geolocation', 'harvest_period', 'documents'],
    })
  })
})

describe('computeHarvestCutoffWarning', () => {
  it('warns when the harvest window ends before the cutoff', () => {
    expect(computeHarvestCutoffWarning('2020-01-01', '2020-06-30')).toBe('harvest_before_cutoff')
  })

  it('warns when the harvest window ends exactly on the cutoff date', () => {
    expect(computeHarvestCutoffWarning('2020-01-01', '2020-12-31')).toBe('harvest_before_cutoff')
  })

  it('falls back to the window start when no end is provided', () => {
    expect(computeHarvestCutoffWarning('2019-05-10', null)).toBe('harvest_before_cutoff')
  })

  it('returns null when the harvest window ends after the cutoff', () => {
    expect(computeHarvestCutoffWarning('2020-06-01', '2021-01-01')).toBeNull()
  })

  it('returns null when the start is pre-cutoff but the end is after it', () => {
    expect(computeHarvestCutoffWarning('2020-01-01', '2021-03-15')).toBeNull()
  })

  it('returns null when no dates are provided', () => {
    expect(computeHarvestCutoffWarning(null, null)).toBeNull()
    expect(computeHarvestCutoffWarning(undefined, undefined)).toBeNull()
  })

  it('returns null for unparseable dates', () => {
    expect(computeHarvestCutoffWarning('not-a-date', 'also-not-a-date')).toBeNull()
  })

  it('accepts Date instances', () => {
    expect(computeHarvestCutoffWarning(new Date('2020-02-01'), new Date('2020-11-30'))).toBe('harvest_before_cutoff')
    expect(computeHarvestCutoffWarning(new Date('2021-02-01'), new Date('2021-11-30'))).toBeNull()
  })

  it('anchors the cutoff at the end of 2020-12-31 UTC', () => {
    expect(HARVEST_CUTOFF_DATE.toISOString()).toBe('2020-12-31T23:59:59.999Z')
  })
})
