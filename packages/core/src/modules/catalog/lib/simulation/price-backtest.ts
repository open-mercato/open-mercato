import { createHash } from 'node:crypto'
import { isUuid } from '@open-mercato/shared/lib/causation/types'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  defineSimulationKind,
  type SimulationArtifactContext,
  type SimulationArtifactVersion,
  type SimulationCoverage,
  type SimulationGroup,
  type SimulationKindResult,
  type SimulationMeasure,
  type SimulationRunContext,
  type SimulationSliceResult,
  type SimulationValidationContext,
  type SimulationValidationResult,
} from '@open-mercato/shared/modules/insights/simulate'
import { CatalogProductPrice } from '../../data/entities'
import { catalogPriceBacktestProposalSchema, type CatalogPriceBacktestProposal } from '../../data/validators'
import {
  CATALOG_PRICE_LINE_OUTCOMES,
  listCatalogPriceLineSources,
  type CatalogPriceBasis,
  type CatalogPriceLineCursor,
  type CatalogPriceLineOutcome,
  type CatalogPriceLineOutcomeKind,
  type CatalogPriceLineProposal,
  type CatalogPriceLineSource,
} from './priceLineSources'
import { readCatalogPriceTimeline, type CatalogPriceTimeline } from './priceTimeline'

export const PRICE_BACKTEST_KIND = 'catalog.price_backtest'

export const PRICE_BACKTEST_ARTIFACT_KIND = 'catalog.price'

/** Bump when the backtest semantics change: it is part of every run's inputs hash. */
export const PRICE_BACKTEST_VERSION = 1

export const PRICE_BACKTEST_CELLS = CATALOG_PRICE_LINE_OUTCOMES

export const PRICE_BACKTEST_FEATURES = ['catalog.pricing.manage']

export const PRICE_BACKTEST_FINGERPRINT_VERSION = 1

/** Lines of the row's product without any price link are counted up to this many per family (coverage). */
export const PRICE_BACKTEST_UNLINKED_LINES_CAP = 10_000

/** Result groups (family × currency × basis) a run keeps; lines of further groups are counted in coverage. */
export const PRICE_BACKTEST_MAX_GROUPS = 64

const SAMPLE_CANDIDATES = 10

const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/

const COVERAGE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/

const DECIMAL_TEXT_PATTERN = /^([+-]?)(\d*)(?:\.(\d*))?$/

const UNKNOWN_CURRENCY = 'unknown'

const BIG_ZERO = BigInt(0)

const REVENUE_ROUNDING = BigInt(10_000)

const HALF_REVENUE_ROUNDING = BigInt(5_000)

export const PRICE_BACKTEST_I18N = {
  label: 'catalog.simulation.kind.priceBacktest',
  caveats: {
    priceIdBrowserOnly: 'catalog.simulation.caveats.priceIdBrowserOnly',
    revenueAsStored: 'catalog.simulation.caveats.revenueAsStored',
    perCurrency: 'catalog.simulation.caveats.perCurrency',
    basisNotProposed: 'catalog.simulation.caveats.basisNotProposed',
    historyTruncated: 'catalog.simulation.caveats.historyTruncated',
    historyUnavailable: 'catalog.simulation.caveats.historyUnavailable',
    noLineSources: 'catalog.simulation.caveats.noLineSources',
    rowMissing: 'catalog.simulation.caveats.rowMissing',
    groupLimit: 'catalog.simulation.caveats.groupLimit',
    truncated: 'catalog.simulation.caveats.truncated',
  },
  warnings: {
    basisNotProposed: 'catalog.simulation.warnings.basisNotProposed',
    currencyDiffers: 'catalog.simulation.warnings.currencyDiffers',
    noLinkedLines: 'catalog.simulation.warnings.noLinkedLines',
  },
} as const

type PriceBacktestCell = CatalogPriceLineOutcomeKind

type GroupState = {
  family: string
  currencyCode: string
  basis: CatalogPriceBasis
  cells: Record<PriceBacktestCell, number>
  samples: Record<PriceBacktestCell, string[]>
  currentRevenue: string
  simulatedRevenue: string
}

type FamilyState = {
  family: string
  cursor: CatalogPriceLineCursor | null
  exhausted: boolean
}

export type PriceBacktestSetup = {
  rowFound: boolean
  productId: string | null
  variantId: string | null
  displayBasis: CatalogPriceBasis | null
  timeline: CatalogPriceTimeline
  historyAvailable: boolean
  noSources: boolean
  omittedCaveats: string[]
}

/** Continuation state (jsonb): revenues are decimal strings of 10^-8 units. */
export type PriceBacktestState = {
  phase: 'scan' | 'done'
  setup: PriceBacktestSetup | null
  families: FamilyState[]
  groups: Record<string, GroupState>
  coverage: Record<string, number>
  lines: number
  truncated: boolean
  groupLimitReached: boolean
}

export function initialPriceBacktestState(): PriceBacktestState {
  return { phase: 'scan', setup: null, families: [], groups: {}, coverage: {}, lines: 0, truncated: false, groupLimitReached: false }
}

function emptyCells(): Record<PriceBacktestCell, number> {
  return { priced_from_row: 0, manual_override: 0, cannot_tell: 0 }
}

function emptySamples(): Record<PriceBacktestCell, string[]> {
  return { priced_from_row: [], manual_override: [], cannot_tell: [] }
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function readOwn<TValue>(record: Record<string, TValue>, key: string): TValue | undefined {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined
}

function bump(state: PriceBacktestState, key: string, by = 1): void {
  if (by === 0 || !COVERAGE_KEY_PATTERN.test(key)) return
  state.coverage[key] = (readOwn(state.coverage, key) ?? 0) + by
}

/**
 * Coverage of one family is keyed `<family>_…` (family ids have no underscore, so prefixes never
 * collide), so a family left out takes its counts with it. The per-reason counts split the
 * `cannot_tell` cells, so the result declares `coverageBreaksDownCells`.
 */
function familyCoverageKey(family: string, key: string): string {
  return `${family}_${key}`
}

function readBigInt(value: string): bigint {
  try {
    return BigInt(value)
  } catch {
    return BIG_ZERO
  }
}

export function priceBacktestGroupKey(family: string, currencyCode: string | null, basis: CatalogPriceBasis | null): string {
  if (!currencyCode || !basis) return family
  return `${family}:${currencyCode}:${basis}`
}

/**
 * A decimal amount (numeric text or number, at most 4 fraction digits after rounding half away
 * from zero) in canonical form `123.4500`, or null for anything that is not a plain decimal.
 */
export function canonicalPriceAmount(value: unknown): string | null {
  const text = typeof value === 'number'
    ? (Number.isFinite(value) ? value.toFixed(12) : null)
    : typeof value === 'string' ? value.trim() : null
  if (!text) return null
  const match = DECIMAL_TEXT_PATTERN.exec(text)
  if (!match) return null
  const [, sign, integerDigits = '', fractionDigits = ''] = match
  if (!integerDigits && !fractionDigits) return null
  const guard = `${fractionDigits}00000`.slice(0, 5)
  const units = (BigInt(`${integerDigits || '0'}${guard}`) + BigInt(5)) / BigInt(10)
  const digits = units.toString().padStart(5, '0')
  const formatted = `${digits.slice(0, digits.length - 4)}.${digits.slice(digits.length - 4)}`
  return sign === '-' && units !== BIG_ZERO ? `-${formatted}` : formatted
}

/** Revenue in 10^-8 units as a decimal string rounded half away from zero to 4 fraction digits (at least 2 shown). */
export function formatRevenueUnits(units: bigint): string {
  const negative = units < BIG_ZERO
  const magnitude = negative ? -units : units
  const rounded = magnitude / REVENUE_ROUNDING + (magnitude % REVENUE_ROUNDING >= HALF_REVENUE_ROUNDING ? BigInt(1) : BIG_ZERO)
  const digits = rounded.toString().padStart(5, '0')
  let fraction = digits.slice(digits.length - 4)
  while (fraction.length > 2 && fraction.endsWith('0')) fraction = fraction.slice(0, -1)
  return `${negative && rounded !== BIG_ZERO ? '-' : ''}${digits.slice(0, digits.length - 4)}.${fraction}`
}

function proposedBases(input: Pick<CatalogPriceBacktestProposal, 'unitPriceNet' | 'unitPriceGross'>): { net: boolean; gross: boolean } {
  return { net: input.unitPriceNet !== undefined, gross: input.unitPriceGross !== undefined }
}

type FingerprintSource = {
  priceId: string
  currencyCode: unknown
  unitPriceNet?: unknown
  unitPriceGross?: unknown
}

/**
 * The fingerprint of what the backtest simulates (S15): the row, its currency and the amounts the
 * proposal sets (an amount the proposal leaves out is left out on both sides — the row's save
 * derives it). Validity dates, quantity tiers and scoping decide nothing about which recorded
 * lines were priced from the row and are left out.
 */
export function fingerprintPriceAmounts(source: FingerprintSource, bases: { net: boolean; gross: boolean }): string {
  const canonical = JSON.stringify({
    fingerprintVersion: PRICE_BACKTEST_FINGERPRINT_VERSION,
    priceId: source.priceId.toLowerCase(),
    currencyCode: typeof source.currencyCode === 'string' ? source.currencyCode.trim().toUpperCase() : null,
    unitPriceNet: bases.net ? canonicalPriceAmount(source.unitPriceNet) : null,
    unitPriceGross: bases.gross ? canonicalPriceAmount(source.unitPriceGross) : null,
    proposes: { net: bases.net, gross: bases.gross },
  })
  return createHash('sha256').update(canonical).digest('hex')
}

export function fingerprintPriceProposal(input: CatalogPriceBacktestProposal): string {
  return fingerprintPriceAmounts(input, proposedBases(input))
}

export function fingerprintPriceRow(row: Pick<CatalogProductPrice, 'id' | 'currencyCode' | 'unitPriceNet' | 'unitPriceGross'>, input: CatalogPriceBacktestProposal): string {
  return fingerprintPriceAmounts(
    { priceId: row.id, currencyCode: row.currencyCode, unitPriceNet: row.unitPriceNet, unitPriceGross: row.unitPriceGross },
    proposedBases(input),
  )
}

type ArtifactLookupContext = Pick<SimulationArtifactContext, 'em' | 'scope'>

async function findPriceRow(ctx: ArtifactLookupContext, priceId: string): Promise<CatalogProductPrice | null> {
  if (!isUuid(priceId)) return null
  return findOneWithDecryption(
    ctx.em,
    CatalogProductPrice,
    { id: priceId.toLowerCase(), tenantId: ctx.scope.tenantId, organizationId: ctx.scope.organizationId },
    { populate: ['priceKind'] },
    { tenantId: ctx.scope.tenantId, organizationId: ctx.scope.organizationId },
  )
}

function toIso(value: Date | null | undefined): string | null {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : null
}

function readReferenceId(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id?: unknown }).id
    return typeof id === 'string' && id.length > 0 ? id : null
  }
  return null
}

function readDisplayBasis(row: CatalogProductPrice): CatalogPriceBasis | null {
  const priceKind = row.priceKind as unknown
  const displayMode = priceKind && typeof priceKind === 'object' && 'displayMode' in priceKind ? (priceKind as { displayMode?: unknown }).displayMode : null
  if (displayMode === 'including-tax') return 'gross'
  if (displayMode === 'excluding-tax') return 'net'
  return null
}

function toLineProposal(input: CatalogPriceBacktestProposal): CatalogPriceLineProposal {
  return {
    currencyCode: input.currencyCode,
    unitPriceNet: input.unitPriceNet === undefined ? null : String(input.unitPriceNet),
    unitPriceGross: input.unitPriceGross === undefined ? null : String(input.unitPriceGross),
  }
}

function sourceOf(family: string): CatalogPriceLineSource | null {
  return listCatalogPriceLineSources().find((source) => source.family === family) ?? null
}

/**
 * What every slice needs, read once in the first one: the row (product / variant for coverage, the
 * kind's display basis for lines without a recorded price mode), its amount timeline, and which
 * document families the requester may read (the others are left out with their caveat).
 */
async function loadSetup(input: CatalogPriceBacktestProposal, ctx: SimulationRunContext<PriceBacktestState>, state: PriceBacktestState): Promise<PriceBacktestSetup> {
  const row = await findPriceRow(ctx, input.priceId)
  const timeline = row ? await readCatalogPriceTimeline(ctx.readRecordHistory, row.id) : { entries: [], exhausted: false, truncated: false }
  const sources = listCatalogPriceLineSources()
  const setup: PriceBacktestSetup = {
    rowFound: Boolean(row),
    productId: row ? readReferenceId(row.product) ?? readReferenceId((row.variant as { product?: unknown } | null | undefined)?.product) : null,
    variantId: row ? readReferenceId(row.variant) : null,
    displayBasis: row ? readDisplayBasis(row) : null,
    timeline,
    historyAvailable: typeof ctx.readRecordHistory === 'function',
    noSources: sources.length === 0,
    omittedCaveats: [],
  }
  if (!row) return setup
  bump(state, 'price_history_entries', timeline.entries.length)
  for (const source of sources) {
    if (!(await ctx.hasFeatures(source.requiredFeatures))) {
      setup.omittedCaveats.push(source.omittedCaveatKey)
      continue
    }
    state.families.push({ family: source.family, cursor: null, exhausted: false })
    const unlinked = await source.countUnlinkedLines({
      em: ctx.em,
      scope: ctx.scope,
      window: ctx.window,
      productId: setup.productId,
      variantId: setup.variantId,
      cap: PRICE_BACKTEST_UNLINKED_LINES_CAP,
    })
    bump(state, familyCoverageKey(source.family, 'lines_without_price_link'), Math.min(unlinked, PRICE_BACKTEST_UNLINKED_LINES_CAP))
    if (unlinked >= PRICE_BACKTEST_UNLINKED_LINES_CAP) bump(state, familyCoverageKey(source.family, 'lines_without_price_link_capped'))
  }
  return setup
}

/**
 * Re-checks the family features before every slice (a requester who lost one has the family, its
 * groups and its coverage dropped and the family's caveat added).
 */
async function dropUnreadableFamilies(ctx: SimulationRunContext<PriceBacktestState>, state: PriceBacktestState, setup: PriceBacktestSetup): Promise<void> {
  const kept: FamilyState[] = []
  for (const family of state.families) {
    const source = sourceOf(family.family)
    if (source && (await ctx.hasFeatures(source.requiredFeatures))) {
      kept.push(family)
      continue
    }
    if (source && !setup.omittedCaveats.includes(source.omittedCaveatKey)) setup.omittedCaveats.push(source.omittedCaveatKey)
    for (const [key, group] of Object.entries(state.groups)) {
      if (group.family === family.family) delete state.groups[key]
    }
    state.lines = Math.max(0, state.lines - (readOwn(state.coverage, familyCoverageKey(family.family, 'lines_scanned')) ?? 0))
    for (const key of Object.keys(state.coverage)) {
      if (key.startsWith(familyCoverageKey(family.family, ''))) delete state.coverage[key]
    }
  }
  state.families = kept
}

function normalizeCurrencyCode(value: string): string {
  const code = value.trim().toUpperCase()
  return CURRENCY_CODE_PATTERN.test(code) ? code : UNKNOWN_CURRENCY
}

function recordOutcome(state: PriceBacktestState, family: string, outcome: CatalogPriceLineOutcome): void {
  const currencyCode = normalizeCurrencyCode(outcome.currencyCode)
  const key = priceBacktestGroupKey(family, currencyCode, outcome.basis)
  let group = readOwn(state.groups, key)
  if (!group) {
    if (Object.keys(state.groups).length >= PRICE_BACKTEST_MAX_GROUPS) {
      state.groupLimitReached = true
      bump(state, familyCoverageKey(family, 'lines_beyond_group_limit'))
      return
    }
    group = {
      family,
      currencyCode,
      basis: outcome.basis,
      cells: emptyCells(),
      samples: emptySamples(),
      currentRevenue: '0',
      simulatedRevenue: '0',
    }
    state.groups[key] = group
  }
  group.cells[outcome.outcome] += 1
  const samples = group.samples[outcome.outcome]
  if (samples.length < SAMPLE_CANDIDATES && outcome.documentId && !samples.includes(outcome.documentId)) samples.push(outcome.documentId)
  if (outcome.outcome === 'priced_from_row' && outcome.currentRevenue !== null && outcome.simulatedRevenue !== null) {
    group.currentRevenue = (readBigInt(group.currentRevenue) + outcome.currentRevenue).toString()
    group.simulatedRevenue = (readBigInt(group.simulatedRevenue) + outcome.simulatedRevenue).toString()
  }
  if (outcome.outcome === 'cannot_tell' && typeof outcome.reason === 'string') {
    bump(state, familyCoverageKey(family, `lines_${outcome.reason}`))
  }
}

function groupMeasures(group: GroupState): SimulationMeasure[] {
  const currencyCode = CURRENCY_CODE_PATTERN.test(group.currencyCode) ? group.currencyCode : null
  const current = readBigInt(group.currentRevenue)
  const simulated = readBigInt(group.simulatedRevenue)
  return [
    { key: 'current_revenue', cell: 'priced_from_row', value: formatRevenueUnits(current), currencyCode },
    { key: 'simulated_revenue', cell: 'priced_from_row', value: formatRevenueUnits(simulated), currencyCode },
    { key: 'revenue_delta', cell: 'priced_from_row', value: formatRevenueUnits(simulated - current), currencyCode },
  ]
}

function groupWarnings(group: GroupState, input: CatalogPriceBacktestProposal): string[] {
  const warnings: string[] = []
  const bases = proposedBases(input)
  if ((group.basis === 'net' && !bases.net) || (group.basis === 'gross' && !bases.gross)) warnings.push(PRICE_BACKTEST_I18N.warnings.basisNotProposed)
  if (group.currencyCode !== input.currencyCode) warnings.push(PRICE_BACKTEST_I18N.warnings.currencyDiffers)
  return warnings
}

function familyGroups(source: CatalogPriceLineSource, state: PriceBacktestState, input: CatalogPriceBacktestProposal): SimulationGroup[] {
  const own = Object.entries(state.groups)
    .filter(([, group]) => group.family === source.family)
    .sort(([left], [right]) => compareCodeUnits(left, right))
  const shared = {
    labelKey: source.labelKey,
    sampleResourceKind: source.sampleResourceKind,
    requiredFeatures: [...source.requiredFeatures],
    flags: [] as string[],
  }
  if (own.length === 0) {
    return [{
      ...shared,
      key: priceBacktestGroupKey(source.family, null, null),
      cells: PRICE_BACKTEST_CELLS.map((cell) => ({ key: cell, count: 0, sampleIds: [] })),
      warnings: [],
      dataWarnings: state.truncated ? [] : [PRICE_BACKTEST_I18N.warnings.noLinkedLines],
    }]
  }
  return own.map(([key, group]): SimulationGroup => ({
    ...shared,
    key,
    cells: PRICE_BACKTEST_CELLS.map((cell) => ({ key: cell, count: group.cells[cell], sampleIds: [...group.samples[cell]] })),
    warnings: groupWarnings(group, input),
    dataWarnings: [],
    measures: groupMeasures(group),
  }))
}

export function buildPriceBacktestResult(state: PriceBacktestState, input: CatalogPriceBacktestProposal): SimulationKindResult {
  const setup = state.setup
  const caveats: string[] = [
    PRICE_BACKTEST_I18N.caveats.priceIdBrowserOnly,
    PRICE_BACKTEST_I18N.caveats.revenueAsStored,
    PRICE_BACKTEST_I18N.caveats.perCurrency,
  ]
  const bases = proposedBases(input)
  if (!bases.net || !bases.gross) caveats.push(PRICE_BACKTEST_I18N.caveats.basisNotProposed)
  if (!setup || !setup.rowFound) {
    caveats.push(PRICE_BACKTEST_I18N.caveats.rowMissing)
    return { groups: [], coverage: {}, caveats, fidelity: 'none', truncated: state.truncated }
  }
  if (!setup.historyAvailable) caveats.push(PRICE_BACKTEST_I18N.caveats.historyUnavailable)
  if (setup.timeline.truncated) caveats.push(PRICE_BACKTEST_I18N.caveats.historyTruncated)
  if (setup.noSources) caveats.push(PRICE_BACKTEST_I18N.caveats.noLineSources)
  caveats.push(...setup.omittedCaveats)
  if (state.groupLimitReached) caveats.push(PRICE_BACKTEST_I18N.caveats.groupLimit)
  if (state.truncated) caveats.push(PRICE_BACKTEST_I18N.caveats.truncated)
  const groups: SimulationGroup[] = []
  for (const family of state.families) {
    const source = sourceOf(family.family)
    if (source) groups.push(...familyGroups(source, state, input))
  }
  const coverage: SimulationCoverage = { ...state.coverage }
  return {
    groups,
    coverage,
    caveats,
    fidelity: state.lines > 0 ? 'reconstructed' : 'none',
    truncated: state.truncated,
    coverageBreaksDownCells: true,
  }
}

function sliceProgress(state: PriceBacktestState): number {
  if (state.families.length === 0) return 0
  const done = state.families.filter((family) => family.exhausted).length
  return Math.min(1, Math.max(0, done / state.families.length))
}

/**
 * One slice of the price backtest (S9). The first slice reads the row, its amount timeline (its
 * own audit history) and which document families the requester may read; then each family's lines
 * referencing the row are scanned and classified by the family's source, in keyset order, within
 * the record budget and the deadlines. Nothing is written: no price, line or document changes.
 */
export async function runPriceBacktestSlice(
  input: CatalogPriceBacktestProposal,
  ctx: SimulationRunContext<PriceBacktestState>,
): Promise<SimulationSliceResult<PriceBacktestState>> {
  const state: PriceBacktestState = ctx.state ?? initialPriceBacktestState()
  let processed = 0
  let recordsRemaining = Math.max(0, Math.floor(ctx.budget.recordsRemaining))
  const finish = (truncated: boolean): SimulationSliceResult<PriceBacktestState> => {
    if (truncated) state.truncated = true
    state.phase = 'done'
    return { status: 'done', result: buildPriceBacktestResult(state, input), recordsProcessed: processed }
  }
  if (!state.setup) {
    state.setup = await loadSetup(input, ctx, state)
    if (!state.setup.rowFound) return finish(false)
  } else {
    await dropUnreadableFamilies(ctx, state, state.setup)
  }
  const setup = state.setup
  const proposal = toLineProposal(input)
  for (const family of state.families) {
    if (family.exhausted) continue
    const source = sourceOf(family.family)
    if (!source) {
      family.exhausted = true
      continue
    }
    while (!family.exhausted) {
      if (ctx.now() >= ctx.budget.runDeadlineAt || recordsRemaining <= 0) return finish(true)
      if (ctx.now() >= ctx.budget.sliceDeadlineAt) {
        return { status: 'continue', state, recordsProcessed: processed, progress: sliceProgress(state) }
      }
      const page = await source.scanPage({
        em: ctx.em,
        scope: ctx.scope,
        window: ctx.window,
        priceId: input.priceId.toLowerCase(),
        after: family.cursor,
        limit: Math.max(1, Math.min(ctx.budget.maxBatchRows, recordsRemaining)),
        timeline: setup.timeline,
        proposal,
        displayBasis: setup.displayBasis,
      })
      for (const outcome of page.outcomes) {
        recordOutcome(state, family.family, outcome)
        bump(state, familyCoverageKey(family.family, 'lines_scanned'))
        state.lines += 1
        processed += 1
        recordsRemaining -= 1
      }
      family.cursor = page.lastCursor ?? family.cursor
      if (page.exhausted) family.exhausted = true
      else if (page.outcomes.length === 0) family.exhausted = true
    }
  }
  return finish(false)
}

/**
 * `artifactId` (when given) must be the proposal's row; the row must exist in the organization (a
 * new row cannot be backtested) and keep its currency.
 */
export async function validatePriceProposal(input: CatalogPriceBacktestProposal, ctx: SimulationValidationContext): Promise<SimulationValidationResult> {
  if (ctx.artifactId && ctx.artifactId.toLowerCase() !== input.priceId.toLowerCase()) return { ok: false, code: 'invalid_proposal' }
  const row = await findPriceRow(ctx, input.priceId)
  if (!row) return { ok: false, code: 'artifact_not_found' }
  if (typeof row.currencyCode !== 'string' || row.currencyCode.trim().toUpperCase() !== input.currencyCode) return { ok: false, code: 'invalid_proposal' }
  return { ok: true }
}

export async function readPriceArtifactVersion(
  ctx: SimulationArtifactContext,
  ref: { artifactId: string | null; input: CatalogPriceBacktestProposal },
): Promise<SimulationArtifactVersion | null> {
  const row = await findPriceRow(ctx, ref.artifactId ?? ref.input.priceId)
  if (!row) return null
  return { artifactId: row.id, updatedAt: toIso(row.updatedAt), fingerprint: fingerprintPriceRow(row, ref.input) }
}

/**
 * `catalog.price_backtest` (spec S9): the proposal is a new net and/or gross amount of an existing
 * price row (`catalogPriceBacktestProposalSchema`). Sources: the price row and its audit history
 * (`catalog.pricing.manage`) and the document lines referencing it, read by the line sources other
 * modules register (`registerCatalogPriceLineSource`), each family only with its own view feature.
 */
export const priceBacktestKind = defineSimulationKind<CatalogPriceBacktestProposal, PriceBacktestState>({
  kind: PRICE_BACKTEST_KIND,
  artifactKind: PRICE_BACKTEST_ARTIFACT_KIND,
  labelKey: PRICE_BACKTEST_I18N.label,
  requiredFeatures: [...PRICE_BACKTEST_FEATURES],
  inputSchema: catalogPriceBacktestProposalSchema,
  version: PRICE_BACKTEST_VERSION,
  cellKeys: [...PRICE_BACKTEST_CELLS],
  readArtifactVersion: readPriceArtifactVersion,
  fingerprintProposal: fingerprintPriceProposal,
  validate: validatePriceProposal,
  run: runPriceBacktestSlice,
  applyHref({ artifactId, runId }) {
    if (!artifactId) return null
    return `/backend/catalog/prices/${encodeURIComponent(artifactId)}/edit?simulationRunId=${encodeURIComponent(runId)}`
  },
})
