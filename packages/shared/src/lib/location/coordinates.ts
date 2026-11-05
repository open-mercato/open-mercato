export const COORDINATE_RANGES = {
  latitude: { min: -90, max: 90 },
  longitude: { min: -180, max: 180 },
} as const

export type CoordinateFieldKind = keyof typeof COORDINATE_RANGES

export type CoordinateValidationResult =
  | { status: 'empty' }
  | { status: 'invalid' }
  | { status: 'outOfRange'; min: number; max: number }
  | { status: 'valid'; value: number }

const DECIMAL_INPUT_PATTERN = /^[+-]?(\d+([.,]\d+)?|[.,]\d+)$/

function parseCoordinate(trimmed: string): number | null {
  if (!DECIMAL_INPUT_PATTERN.test(trimmed)) return null
  const parsed = Number.parseFloat(trimmed.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

export function validateCoordinateInput(
  kind: CoordinateFieldKind,
  value: string | undefined,
): CoordinateValidationResult {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed.length) return { status: 'empty' }
  const parsed = parseCoordinate(trimmed)
  if (parsed === null) return { status: 'invalid' }
  const { min, max } = COORDINATE_RANGES[kind]
  if (parsed < min || parsed > max) return { status: 'outOfRange', min, max }
  return { status: 'valid', value: parsed }
}

export function normalizeCoordinateInput(value: string | undefined): number | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed.length) return undefined
  const parsed = parseCoordinate(trimmed)
  return parsed === null ? undefined : parsed
}
