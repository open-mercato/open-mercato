import {
  COMPLETENESS_DIMENSIONS,
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
