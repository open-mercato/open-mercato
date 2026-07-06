import { GEOJSON_TYPES } from '../data/validators'

export const COMPLETENESS_DIMENSIONS = ['origin_country', 'geolocation', 'quantity', 'harvest_period', 'producer', 'documents'] as const
export type CompletenessDimension = (typeof COMPLETENESS_DIMENSIONS)[number]

export type CompletenessInput = {
  originCountry?: string | null
  geolocation?: unknown
  quantityKg?: string | number | null
  harvestFrom?: Date | string | null
  harvestTo?: Date | string | null
  producerName?: string | null
  attachmentIds?: string[] | null
}

export type CompletenessResult = { score: number; missingFields: CompletenessDimension[] }

function isOriginCountryComplete(value: string | null | undefined): boolean {
  return typeof value === 'string' && /^[A-Za-z]{2}$/.test(value.trim())
}

function isGeolocationComplete(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as { type?: unknown }
  return typeof candidate.type === 'string' && GEOJSON_TYPES.includes(candidate.type as (typeof GEOJSON_TYPES)[number])
}

function isQuantityComplete(value: string | number | null | undefined): boolean {
  if (typeof value !== 'string' && typeof value !== 'number') return false
  const quantity = Number(value)
  return Number.isFinite(quantity) && quantity > 0
}

function parseDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function isHarvestPeriodComplete(harvestFrom: Date | string | null | undefined, harvestTo: Date | string | null | undefined): boolean {
  const parsedHarvestFrom = parseDate(harvestFrom)
  const parsedHarvestTo = parseDate(harvestTo)
  return parsedHarvestFrom !== null && parsedHarvestTo !== null && parsedHarvestFrom <= parsedHarvestTo
}

function isProducerComplete(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function isDocumentsComplete(value: string[] | null | undefined): boolean {
  return Array.isArray(value) && value.length >= 1
}

export function computeSubmissionCompleteness(input: CompletenessInput): CompletenessResult {
  const completionByDimension: Record<CompletenessDimension, boolean> = {
    origin_country: isOriginCountryComplete(input.originCountry),
    geolocation: isGeolocationComplete(input.geolocation),
    quantity: isQuantityComplete(input.quantityKg),
    harvest_period: isHarvestPeriodComplete(input.harvestFrom, input.harvestTo),
    producer: isProducerComplete(input.producerName),
    documents: isDocumentsComplete(input.attachmentIds),
  }

  const missingFields = COMPLETENESS_DIMENSIONS.filter((dimension) => !completionByDimension[dimension])
  const metCount = COMPLETENESS_DIMENSIONS.length - missingFields.length
  const score = Math.round((metCount / COMPLETENESS_DIMENSIONS.length) * 100)

  return { score, missingFields }
}
