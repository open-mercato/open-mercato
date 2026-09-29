import {
  collectFeatures,
  validatePlotGeometry,
} from '../geometry'

describe('validatePlotGeometry', () => {
  it('normalizes a GeoJSON feature point and preserves properties', () => {
    const result = validatePlotGeometry({
      type: 'Feature',
      properties: { name: 'Plot A' },
      geometry: { type: 'Point', coordinates: [19.012345, 52.123456] },
    })

    expect(result).toMatchObject({
      ok: true,
      plotType: 'point',
      computedAreaHa: null,
      warnings: [],
    })
    if (result.ok) {
      expect(result.feature.properties).toEqual({ name: 'Plot A' })
    }
  })

  it('computes polygon area and accepts bare geometries', () => {
    const result = validatePlotGeometry({
      type: 'Polygon',
      coordinates: [[
        [0.000001, 0.000001],
        [0.001001, 0.000001],
        [0.001001, 0.001001],
        [0.000001, 0.001001],
        [0.000001, 0.000001],
      ]],
    })

    expect(result).toMatchObject({
      ok: true,
      plotType: 'polygon',
      warnings: [],
    })
    if (result.ok) {
      expect(result.computedAreaHa).toBeGreaterThan(1.2)
      expect(result.computedAreaHa).toBeLessThan(1.3)
    }
  })

  it('warns when any coordinate has fewer than six decimal places', () => {
    const result = validatePlotGeometry({ type: 'Point', coordinates: [19.1, 52.123456] })

    expect(result).toMatchObject({
      ok: true,
      warnings: ['low_precision'],
    })
  })

  it('rejects coordinates outside valid longitude and latitude ranges', () => {
    expect(validatePlotGeometry({ type: 'Point', coordinates: [181, 52] })).toEqual({
      ok: false,
      errorKey: 'geometryOutOfRange',
    })
  })

  it('rejects unclosed polygon rings', () => {
    expect(validatePlotGeometry({
      type: 'Polygon',
      coordinates: [[
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ]],
    })).toEqual({
      ok: false,
      errorKey: 'geometryRingNotClosed',
    })
  })

  it('rejects oversized geometry payloads', () => {
    expect(validatePlotGeometry({
      type: 'Feature',
      properties: { description: 'x'.repeat(262_144) },
      geometry: { type: 'Point', coordinates: [19.012345, 52.123456] },
    })).toEqual({
      ok: false,
      errorKey: 'geometryTooLarge',
    })
  })
})

describe('collectFeatures', () => {
  it('extracts features from a FeatureCollection without validating each feature', () => {
    expect(collectFeatures({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } },
      ],
    })).toEqual({
      ok: true,
      features: [
        { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } },
      ],
    })
  })

  it('rejects FeatureCollection imports with too many features', () => {
    expect(collectFeatures({
      type: 'FeatureCollection',
      features: Array.from({ length: 501 }, () => ({ type: 'Feature' })),
    })).toEqual({
      ok: false,
      errorKey: 'importTooManyFeatures',
    })
  })

  it('rejects oversized FeatureCollection imports', () => {
    expect(collectFeatures({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { description: 'x'.repeat(1_048_576) } }],
    })).toEqual({
      ok: false,
      errorKey: 'importTooLarge',
    })
  })
})
