import {
  assertPointAreaWithinLimit,
  isPolygonGeometry,
  parsePlotAreaInput,
  parsePlotGeometryForSubmit,
  pointAreaExceedsLimit,
} from '../plotForm'
import { translateEudrCrudError } from '../crudErrorI18n'
import { POINT_MAX_AREA_HA } from '../../lib/geometry'

const DICTIONARY: Record<string, string> = {
  'eudr.errors.polygonRequired': 'Use polygon geometry for plots larger than 4 hectares.',
  'eudr.errors.pointAreaRequired': 'Point plots require a positive area.',
  'eudr.errors.geometryRequired': 'Provide plot geometry.',
}

const translate = (key: string) => DICTIONARY[key] ?? key

const POINT_GEOMETRY = JSON.stringify({ type: 'Point', coordinates: [19.9449, 50.0646] })
const POLYGON_GEOMETRY = JSON.stringify({
  type: 'Polygon',
  coordinates: [[[19.9, 50.0], [19.91, 50.0], [19.91, 50.01], [19.9, 50.01], [19.9, 50.0]]],
})

type FormError = Error & { fieldErrors?: Record<string, string> }

function captureError(run: () => void): FormError {
  try {
    run()
  } catch (err) {
    return err as FormError
  }
  throw new Error('expected the call to throw')
}

describe('parsePlotGeometryForSubmit', () => {
  it('returns the parsed geometry and plot type', () => {
    const point = parsePlotGeometryForSubmit(POINT_GEOMETRY, translate)
    expect(point.plotType).toBe('point')
    const polygon = parsePlotGeometryForSubmit(POLYGON_GEOMETRY, translate)
    expect(polygon.plotType).toBe('polygon')
  })

  it('throws a translated geometry-required error for empty input', () => {
    const error = captureError(() => parsePlotGeometryForSubmit('', translate))
    expect(error.message).toBe('Provide plot geometry.')
    expect(error.fieldErrors).toEqual({ geometry: 'Provide plot geometry.' })
  })
})

describe('point area rules', () => {
  it('rejects a point plot declared larger than the polygon threshold', () => {
    const error = captureError(() => assertPointAreaWithinLimit('point', POINT_MAX_AREA_HA + 1, translate))
    expect(error.message).toBe('Use polygon geometry for plots larger than 4 hectares.')
    expect(error.fieldErrors).toEqual({ areaHa: 'Use polygon geometry for plots larger than 4 hectares.' })
  })

  it('requires a positive area for point plots', () => {
    const error = captureError(() => assertPointAreaWithinLimit('point', null, translate))
    expect(error.message).toBe('Point plots require a positive area.')
  })

  it('accepts point plots at or below the threshold and ignores polygons', () => {
    expect(() => assertPointAreaWithinLimit('point', POINT_MAX_AREA_HA, translate)).not.toThrow()
    expect(() => assertPointAreaWithinLimit('polygon', null, translate)).not.toThrow()
  })

  it('flags over-limit point areas for the geometry panel', () => {
    expect(pointAreaExceedsLimit('point', '5')).toBe(true)
    expect(pointAreaExceedsLimit('point', String(POINT_MAX_AREA_HA))).toBe(false)
    expect(pointAreaExceedsLimit('point', '')).toBe(false)
    expect(pointAreaExceedsLimit('polygon', '5')).toBe(false)
  })
})

describe('parsePlotAreaInput / isPolygonGeometry', () => {
  it('parses numeric text and passes through blanks', () => {
    expect(parsePlotAreaInput('2.5', translate)).toBe(2.5)
    expect(parsePlotAreaInput('', translate)).toBeNull()
    expect(parsePlotAreaInput(undefined, translate)).toBeNull()
  })

  it('detects polygon geometry text', () => {
    expect(isPolygonGeometry(POLYGON_GEOMETRY)).toBe(true)
    expect(isPolygonGeometry(POINT_GEOMETRY)).toBe(false)
    expect(isPolygonGeometry('not json')).toBe(false)
  })
})

describe('translateEudrCrudError', () => {
  it('translates a machine error key from the server', () => {
    const raw = new Error('eudr.errors.polygonRequired')
    const translated = translateEudrCrudError(raw, translate) as FormError
    expect(translated.message).toBe('Use polygon geometry for plots larger than 4 hectares.')
  })

  it('keeps the raw key when no translation exists', () => {
    const raw = new Error('eudr.errors.someUnknownKey')
    expect(translateEudrCrudError(raw, translate)).toBe(raw)
  })

  it('leaves non-key messages untouched', () => {
    const raw = new Error('Something else went wrong')
    expect(translateEudrCrudError(raw, translate)).toBe(raw)
  })

  it('translates field error values too', () => {
    const raw = new Error('eudr.errors.pointAreaRequired') as FormError
    raw.fieldErrors = { areaHa: 'eudr.errors.pointAreaRequired' }
    const translated = translateEudrCrudError(raw, translate) as FormError
    expect(translated.message).toBe('Point plots require a positive area.')
    expect(translated.fieldErrors).toEqual({ areaHa: 'Point plots require a positive area.' })
  })
})
