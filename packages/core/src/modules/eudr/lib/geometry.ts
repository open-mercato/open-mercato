export type EudrPlotGeometryType = 'point' | 'polygon'

type GeoJsonPosition = [number, number]
type GeoJsonPoint = { type: 'Point'; coordinates: GeoJsonPosition }
type GeoJsonPolygon = { type: 'Polygon'; coordinates: GeoJsonPosition[][] }
type GeoJsonMultiPolygon = { type: 'MultiPolygon'; coordinates: GeoJsonPosition[][][] }
type GeoJsonSupportedGeometry = GeoJsonPoint | GeoJsonPolygon | GeoJsonMultiPolygon

export type GeoJsonFeature = {
  type: 'Feature'
  properties: Record<string, unknown>
  geometry: GeoJsonSupportedGeometry
}

export type GeometryValidationResult =
  | { ok: true; feature: GeoJsonFeature; plotType: EudrPlotGeometryType; computedAreaHa: number | null; warnings: string[] }
  | { ok: false; errorKey: string }

type PositionValidationResult =
  | { ok: true; position: GeoJsonPosition; lowPrecision: boolean }
  | { ok: false; errorKey: 'geometryOutOfRange' }

const MAX_GEOMETRY_SIZE = 262_144
const MAX_IMPORT_SIZE = 1_048_576
const MAX_FEATURE_COLLECTION_FEATURES = 500
const EARTH_RADIUS_METERS = 6_371_008.8

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function serializedLength(value: unknown): number | null {
  try {
    const serialized = JSON.stringify(value)
    return typeof serialized === 'string' ? serialized.length : null
  } catch {
    return null
  }
}

function decimalPlaces(value: number): number {
  const decimal = String(value).split(/[eE]/)[0]?.split('.')[1]
  return decimal?.length ?? 0
}

function validatePosition(input: unknown): PositionValidationResult {
  if (!Array.isArray(input) || input.length < 2) return { ok: false, errorKey: 'geometryOutOfRange' }
  const [longitude, latitude] = input
  if (typeof longitude !== 'number' || typeof latitude !== 'number') return { ok: false, errorKey: 'geometryOutOfRange' }
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return { ok: false, errorKey: 'geometryOutOfRange' }
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return { ok: false, errorKey: 'geometryOutOfRange' }

  return {
    ok: true,
    position: [longitude, latitude],
    lowPrecision: decimalPlaces(longitude) < 6 || decimalPlaces(latitude) < 6,
  }
}

function positionsEqual(left: GeoJsonPosition, right: GeoJsonPosition): boolean {
  return left[0] === right[0] && left[1] === right[1]
}

function validateRing(input: unknown): { ok: true; ring: GeoJsonPosition[]; lowPrecision: boolean } | { ok: false; errorKey: string } {
  if (!Array.isArray(input)) return { ok: false, errorKey: 'geometryInvalid' }
  if (input.length < 4) return { ok: false, errorKey: 'geometryRingNotClosed' }

  const ring: GeoJsonPosition[] = []
  let lowPrecision = false
  for (const candidate of input) {
    const result = validatePosition(candidate)
    if (!result.ok) return result
    ring.push(result.position)
    lowPrecision = lowPrecision || result.lowPrecision
  }

  if (!positionsEqual(ring[0], ring[ring.length - 1])) return { ok: false, errorKey: 'geometryRingNotClosed' }
  return { ok: true, ring, lowPrecision }
}

function validatePolygonCoordinates(input: unknown): { ok: true; rings: GeoJsonPosition[][]; lowPrecision: boolean } | { ok: false; errorKey: string } {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, errorKey: 'geometryInvalid' }

  const rings: GeoJsonPosition[][] = []
  let lowPrecision = false
  for (const candidate of input) {
    const result = validateRing(candidate)
    if (!result.ok) return result
    rings.push(result.ring)
    lowPrecision = lowPrecision || result.lowPrecision
  }

  return { ok: true, rings, lowPrecision }
}

function validateGeometry(input: unknown): { ok: true; geometry: GeoJsonSupportedGeometry; lowPrecision: boolean } | { ok: false; errorKey: string } {
  if (!isRecord(input) || typeof input.type !== 'string') return { ok: false, errorKey: 'geometryInvalid' }

  if (input.type === 'Point') {
    const result = validatePosition(input.coordinates)
    if (!result.ok) return result
    return { ok: true, geometry: { type: 'Point', coordinates: result.position }, lowPrecision: result.lowPrecision }
  }

  if (input.type === 'Polygon') {
    const result = validatePolygonCoordinates(input.coordinates)
    if (!result.ok) return result
    return { ok: true, geometry: { type: 'Polygon', coordinates: result.rings }, lowPrecision: result.lowPrecision }
  }

  if (input.type === 'MultiPolygon') {
    if (!Array.isArray(input.coordinates) || input.coordinates.length === 0) return { ok: false, errorKey: 'geometryInvalid' }
    const polygons: GeoJsonPosition[][][] = []
    let lowPrecision = false
    for (const candidate of input.coordinates) {
      const result = validatePolygonCoordinates(candidate)
      if (!result.ok) return result
      polygons.push(result.rings)
      lowPrecision = lowPrecision || result.lowPrecision
    }
    return { ok: true, geometry: { type: 'MultiPolygon', coordinates: polygons }, lowPrecision }
  }

  return { ok: false, errorKey: 'geometryInvalid' }
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180
}

function ringAreaSquareMeters(ring: GeoJsonPosition[]): number {
  let total = 0
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [longitude1, latitude1] = ring[index]
    const [longitude2, latitude2] = ring[index + 1]
    total += (toRadians(longitude2) - toRadians(longitude1)) * (2 + Math.sin(toRadians(latitude1)) + Math.sin(toRadians(latitude2)))
  }
  return Math.abs((total * EARTH_RADIUS_METERS * EARTH_RADIUS_METERS) / 2)
}

function polygonAreaSquareMeters(rings: GeoJsonPosition[][]): number {
  const [exterior, ...holes] = rings
  const holesArea = holes.reduce((sum, ring) => sum + ringAreaSquareMeters(ring), 0)
  return Math.max(0, ringAreaSquareMeters(exterior) - holesArea)
}

function areaHa(geometry: GeoJsonPolygon | GeoJsonMultiPolygon): number {
  // Spherical-excess area is approximate, but is within about 0.5% at normal
  // plot scale and sufficient for the 4-ha EUDR threshold hinting flow.
  const squareMeters = geometry.type === 'Polygon'
    ? polygonAreaSquareMeters(geometry.coordinates)
    : geometry.coordinates.reduce((sum, polygon) => sum + polygonAreaSquareMeters(polygon), 0)

  return Math.round((squareMeters / 10_000) * 10_000) / 10_000
}

export function validatePlotGeometry(input: unknown): GeometryValidationResult {
  const length = serializedLength(input)
  if (length === null) return { ok: false, errorKey: 'geometryInvalid' }
  if (length > MAX_GEOMETRY_SIZE) return { ok: false, errorKey: 'geometryTooLarge' }

  const isFeature = isRecord(input) && input.type === 'Feature'
  const geometryInput = isFeature ? input.geometry : input
  const properties = isFeature && isRecord(input.properties) ? input.properties : {}
  const result = validateGeometry(geometryInput)
  if (!result.ok) return result

  const plotType: EudrPlotGeometryType = result.geometry.type === 'Point' ? 'point' : 'polygon'
  return {
    ok: true,
    feature: { type: 'Feature', properties, geometry: result.geometry },
    plotType,
    computedAreaHa: result.geometry.type === 'Point' ? null : areaHa(result.geometry),
    warnings: result.lowPrecision ? ['low_precision'] : [],
  }
}

export function collectFeatures(featureCollection: unknown): { ok: true; features: unknown[] } | { ok: false; errorKey: string } {
  const length = serializedLength(featureCollection)
  if (length === null) return { ok: false, errorKey: 'geometryInvalid' }
  if (length > MAX_IMPORT_SIZE) return { ok: false, errorKey: 'importTooLarge' }

  if (!isRecord(featureCollection) || featureCollection.type !== 'FeatureCollection' || !Array.isArray(featureCollection.features)) {
    return { ok: false, errorKey: 'geometryInvalid' }
  }

  if (featureCollection.features.length > MAX_FEATURE_COLLECTION_FEATURES) return { ok: false, errorKey: 'importTooManyFeatures' }
  return { ok: true, features: featureCollection.features }
}
