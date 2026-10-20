import type { EntityManager } from '@mikro-orm/postgresql'
import type { SimulationScope, SimulationWindow } from '@open-mercato/shared/modules/insights/simulate'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { CatalogPriceTimeline } from './priceTimeline'

const logger = createLogger('catalog').child({ component: 'price-line-sources' })

/**
 * Soft-optional hook of the price backtest (`catalog.price_backtest`, spec
 * `2026-10-08-insights-change-simulator.md` S9). Catalog owns the artifact (the price row, its
 * fingerprint and its amount timeline); the module that records document lines referencing a price
 * row (`metadata.priceId`, e.g. sales order and quote lines) owns finding and classifying them and
 * registers one source per document family from its own `insights.simulate.ts`. Without a
 * registered source (e.g. the sales module disabled) the backtest reports that no lines can be read.
 */

export type CatalogPriceBasis = 'net' | 'gross'

export const CATALOG_PRICE_LINE_OUTCOMES = ['priced_from_row', 'manual_override', 'cannot_tell'] as const

export type CatalogPriceLineOutcomeKind = (typeof CATALOG_PRICE_LINE_OUTCOMES)[number]

/** Keyset position of a line scan; `at` is the line's `created_at` with microseconds. */
export type CatalogPriceLineCursor = {
  at: string
  id: string
}

/** The proposed amounts as decimal strings; an amount the proposal leaves out is null. */
export type CatalogPriceLineProposal = {
  currencyCode: string
  unitPriceNet: string | null
  unitPriceGross: string | null
}

export type CatalogPriceLineScanQuery = {
  em: EntityManager
  scope: SimulationScope
  window: SimulationWindow
  priceId: string
  after: CatalogPriceLineCursor | null
  limit: number
  timeline: CatalogPriceTimeline
  proposal: CatalogPriceLineProposal
  /** The basis the price row's kind displays (`including-tax` → gross), used to group lines without a recorded price mode. */
  displayBasis: CatalogPriceBasis | null
}

/**
 * One classified line. `basis` is the amount the line was priced in (its recorded price mode, else
 * the row's display basis); `reason` (snake_case) says why a line is `cannot_tell`. Revenues are
 * unit price × quantity as stored, in units of 10^-8, for `priced_from_row` lines only.
 */
export type CatalogPriceLineOutcome = {
  lineId: string
  documentId: string
  currencyCode: string
  basis: CatalogPriceBasis
  outcome: CatalogPriceLineOutcomeKind
  reason: string | null
  currentRevenue: bigint | null
  simulatedRevenue: bigint | null
}

export type CatalogPriceLineScanPage = {
  outcomes: CatalogPriceLineOutcome[]
  lastCursor: CatalogPriceLineCursor | null
  exhausted: boolean
}

export type CatalogPriceUnlinkedLinesQuery = {
  em: EntityManager
  scope: SimulationScope
  window: SimulationWindow
  productId: string | null
  variantId: string | null
  cap: number
}

/**
 * A document family whose lines reference price rows. `family` (`[a-z][a-z0-9]{0,15}`) names the result
 * groups (`<family>:<currency>:<basis>`); `requiredFeatures` gate the whole family (a requester
 * without them gets the family left out with `omittedCaveatKey`); `sampleResourceKind` is the
 * explain resource that confirms sample document ids.
 */
export type CatalogPriceLineSource = {
  family: string
  labelKey: string
  requiredFeatures: string[]
  sampleResourceKind: string
  omittedCaveatKey: string
  scanPage(query: CatalogPriceLineScanQuery): Promise<CatalogPriceLineScanPage>
  countUnlinkedLines(query: CatalogPriceUnlinkedLinesQuery): Promise<number>
}

/** Short, without underscores: coverage keys are `<family>_<item>` and must stay unambiguous and ≤ 64 characters. */
const FAMILY_PATTERN = /^[a-z][a-z0-9]{0,15}$/

const REGISTRY_KEY = Symbol.for('@open-mercato/core/catalog/price-line-sources')

type GlobalWithPriceLineSources = typeof globalThis & {
  [REGISTRY_KEY]?: Map<string, CatalogPriceLineSource>
}

function resolveRegistry(): Map<string, CatalogPriceLineSource> {
  const scope = globalThis as GlobalWithPriceLineSources
  if (!scope[REGISTRY_KEY]) scope[REGISTRY_KEY] = new Map()
  return scope[REGISTRY_KEY]
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function isValidCatalogPriceLineSource(value: unknown): value is CatalogPriceLineSource {
  if (!value || typeof value !== 'object') return false
  const source = value as Partial<CatalogPriceLineSource>
  if (typeof source.family !== 'string' || !FAMILY_PATTERN.test(source.family)) return false
  if (!isNonEmptyString(source.labelKey) || !isNonEmptyString(source.sampleResourceKind) || !isNonEmptyString(source.omittedCaveatKey)) return false
  if (!Array.isArray(source.requiredFeatures) || source.requiredFeatures.length === 0 || !source.requiredFeatures.every(isNonEmptyString)) return false
  return typeof source.scanPage === 'function' && typeof source.countUnlinkedLines === 'function'
}

/**
 * Registers a line source (first registration of a family wins; an invalid source — e.g. one
 * without `requiredFeatures` — is skipped: fail closed).
 */
export function registerCatalogPriceLineSource(source: CatalogPriceLineSource): void {
  if (!isValidCatalogPriceLineSource(source)) {
    logger.warn('[internal] Ignoring an invalid price line source (fail closed)')
    return
  }
  const registry = resolveRegistry()
  if (registry.has(source.family)) return
  registry.set(source.family, source)
}

/** Registered sources in family order (stable across processes). */
export function listCatalogPriceLineSources(): CatalogPriceLineSource[] {
  return Array.from(resolveRegistry().values()).sort((left, right) => (left.family < right.family ? -1 : left.family > right.family ? 1 : 0))
}

export function resetCatalogPriceLineSourcesForTests(): void {
  resolveRegistry().clear()
}
