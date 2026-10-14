/**
 * The money of a customer report — screens 13 and 14, decisions D-2, D-5 and D-7.
 *
 * Three rules are load-bearing here and everything else in this file exists to
 * keep them true.
 *
 * **D-7 — round at the entry, then sum upward.** `entryAmount` from
 * `lib/time-tracking/cost.ts` is the ONLY place an amount is produced, and every
 * level above it (line, group, grand total) is an exact integer-cent sum of
 * already-rounded values via `sumAmounts`. Two properties fall out, and both are
 * asserted by this module's tests:
 *
 *   - a client adding up the printed lines reaches our total, because the total
 *     is literally that addition;
 *   - the grand total does not move when the grouping changes from task to
 *     person to day, because it is a sum over ENTRIES and never over lines, so
 *     redrawing the line boundaries cannot redistribute a rounding remainder.
 *
 * **D-2 — a task line is an inclusive rollup.** A child task's time folds into
 * its parent's line and is expandable underneath, so a client-facing sheet stays
 * at the level they contracted for. The line aggregates ENTRIES, never other
 * lines (risk R10), so a parent line is never a sum of a child line plus itself.
 *
 * **D-5 — an hour frozen in a closed report is excluded by default.** Excluded
 * entries are not silently dropped: they are counted, their minutes are summed
 * and the reports that froze them are named, so the config screen can show what
 * is being skipped. When the opt-in is ticked they re-enter at their FROZEN
 * values — the amount the client was already billed — not at whatever today's
 * rounding rule and today's project rate would produce.
 */

import {
  applicableRateExact,
  entryAmountExact,
  round2,
  sumAmounts,
  sumAmountsExact,
  DEFAULT_STAFF_AMOUNT_DECIMAL_PLACES,
} from '../time-tracking/cost'
import { decimalToNumber, decimalToString, parseDecimal, sumDecimals } from '@open-mercato/shared/lib/decimal'
import {
  getReportGrouping,
  isBuiltInReportGrouping,
  REPORT_GROUPING_REGISTRY_ID,
  DEFAULT_REPORT_GROUPING,
  UNASSIGNED_LINE_KEY,
  type ReportGrouping,
  type ReportGroupingLabelContext,
  type ReportGroupingStrategy,
} from './reportGroupings'
import { runStrategy } from '../time-tracking/registries/invoke'

export type { ReportGrouping }
export type ReportNonBillableMode = 'separate' | 'exclude'

/** The freeze record of an entry already closed into an earlier report. */
export type FrozenEntryValues = {
  reportId: string
  reference: string | null
  title: string | null
  rawMinutes: number
  roundedMinutes: number
  rateAmount: number | null
  rateAmountExact?: string | null
  currencyCode: string | null
  amount: number | null
  amountExact?: string | null
  isBillable: boolean
}

export type ReportInputEntry = {
  id: string
  timeProjectId: string
  /** The task the entry is logged against, or null for project-level time. */
  taskId: string | null
  /** Resolved top-level ancestor of `taskId` (D-2); equals `taskId` for a root task. */
  rootTaskId: string | null
  staffMemberId: string | null
  /** `yyyy-mm-dd`. */
  date: string
  durationMinutes: number
  roundedMinutes: number | null
  isBillable: boolean
  rateOverrideAmount: number | null
  rateOverrideAmountExact?: string | null
  description: string | null
  /** Present when this entry is already frozen in a closed report (D-5). */
  frozen: FrozenEntryValues | null
}

export type ReportInputProject = {
  id: string
  name: string
  hourlyRate: number | null
  hourlyRateExact?: string | null
  currencyCode: string | null
}

export type ReportDirectory = {
  taskLabelById: Readonly<Record<string, string>>
  personLabelById: Readonly<Record<string, string>>
}

export type ReportTotalsOptions = {
  grouping: ReportGrouping
  nonbillableMode: ReportNonBillableMode
  includeAlreadyReported: boolean
  /** Decimals amounts round to (the report currency's); defaults to 2. */
  amountDecimalPlaces?: number
}

/** What one entry actually contributes, after D-5 and D-7 have been applied. */
export type ResolvedEntryValues = {
  entryId: string
  minutes: number
  rawMinutes: number
  rate: number | null
  rateExact?: string | null
  amount: number | null
  amountExact?: string | null
  isBillable: boolean
  hasOverride: boolean
  isFrozen: boolean
}

/** `ResolvedEntryValues` as `resolveEntryValues` produces it: the exact siblings are always set. */
export type ExactResolvedEntryValues = ResolvedEntryValues & {
  rateExact: string | null
  amountExact: string | null
}

export type ReportLine = {
  key: string
  label: string
  minutes: number
  /** The rate every entry on this line agreed on, or null when they disagree. */
  rate: number | null
  rateExact?: string | null
  amount: number
  amountExact?: string
  entryCount: number
  hasOverride: boolean
  /** Child-task rollup detail (D-2); empty for person and day groupings. */
  children: ReportLine[]
}

/** `ReportLine` as `computeReportTotals` produces it: the exact siblings are always set. */
export type ExactReportLine = Omit<ReportLine, 'rateExact' | 'amountExact' | 'children'> & {
  rateExact: string | null
  amountExact: string
  children: ExactReportLine[]
}

export type ReportGroup = {
  key: string
  kind: 'project' | 'nonbillable'
  label: string
  rate: number | null
  rateExact?: string | null
  minutes: number
  amount: number
  amountExact?: string
  entryCount: number
  lines: ReportLine[]
}

/** `ReportGroup` as `computeReportTotals` produces it: the exact siblings are always set. */
export type ExactReportGroup = Omit<ReportGroup, 'rateExact' | 'amountExact' | 'lines'> & {
  rateExact: string | null
  amountExact: string
  lines: ExactReportLine[]
}

export type AlreadyReportedSource = {
  reportId: string
  reference: string | null
  title: string | null
  entryCount: number
  minutes: number
}

export type ReportTotals = {
  groups: ReportGroup[]
  billableMinutes: number
  nonbillableMinutes: number
  entryCount: number
  totalAmount: number
  totalAmountExact?: string
  /** Entries skipped because they are frozen elsewhere (D-5). Zero when opted in. */
  alreadyReportedCount: number
  alreadyReportedMinutes: number
  alreadyReportedIn: AlreadyReportedSource[]
}

/** `ReportTotals` as `computeReportTotals` produces it: the exact siblings are always set. */
export type ExactReportTotals = Omit<ReportTotals, 'groups' | 'totalAmountExact'> & {
  groups: ExactReportGroup[]
  totalAmountExact: string
}


function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * The minutes an entry bills at. `rounded_minutes` is written by every entry
 * write path (T4.2), but an entry created before that column existed carries
 * null — falling back to the raw duration bills the truth rather than zero.
 */
export function effectiveMinutes(entry: Pick<ReportInputEntry, 'durationMinutes' | 'roundedMinutes'>): number {
  const rounded = finiteOrNull(entry.roundedMinutes)
  if (rounded !== null) return rounded
  const raw = finiteOrNull(entry.durationMinutes)
  return raw ?? 0
}

/**
 * D-7 in one place: the only per-entry money computation in the report path.
 * A frozen entry restates what it was billed at; a live entry is costed from
 * its rounded minutes and its applicable rate.
 */
function exactOrNull(exact: string | null | undefined, legacy: number | null | undefined): string | null {
  const parsed = parseDecimal(exact) ?? parseDecimal(finiteOrNull(legacy))
  return parsed ? decimalToString(parsed) : null
}

function numberOrNull(exact: string | null): number | null {
  return exact === null ? null : decimalToNumber(exact)
}

export function resolveEntryValues(
  entry: ReportInputEntry,
  project: ReportInputProject | null | undefined,
  amountDecimalPlaces: number = DEFAULT_STAFF_AMOUNT_DECIMAL_PLACES,
): ExactResolvedEntryValues {
  const frozen = entry.frozen
  const override = exactOrNull(entry.rateOverrideAmountExact, entry.rateOverrideAmount)
  if (frozen) {
    const rateExact = exactOrNull(frozen.rateAmountExact, frozen.rateAmount)
    const amountExact = frozen.isBillable ? exactOrNull(frozen.amountExact, frozen.amount) : null
    return {
      entryId: entry.id,
      minutes: finiteOrNull(frozen.roundedMinutes) ?? 0,
      rawMinutes: finiteOrNull(frozen.rawMinutes) ?? 0,
      rate: numberOrNull(rateExact),
      rateExact,
      amount: numberOrNull(amountExact),
      amountExact,
      isBillable: frozen.isBillable,
      hasOverride: override !== null,
      isFrozen: true,
    }
  }

  const minutes = effectiveMinutes(entry)
  const projectRate = project ? { hourlyRate: exactOrNull(project.hourlyRateExact, project.hourlyRate) } : null
  // EP-33: the override → project-rate chain is the rate registry's built-in, so
  // the report path asks it rather than restating the chain here.
  const rateExact = entry.isBillable ? applicableRateExact({ rateOverrideAmount: override }, projectRate) : null
  const amountExact = entryAmountExact(
    { isBillable: entry.isBillable, roundedMinutes: minutes, rateOverrideAmount: override },
    projectRate,
    null,
    amountDecimalPlaces,
  )
  return {
    entryId: entry.id,
    minutes,
    rawMinutes: finiteOrNull(entry.durationMinutes) ?? 0,
    rate: numberOrNull(rateExact),
    rateExact,
    amount: numberOrNull(amountExact),
    amountExact,
    isBillable: entry.isBillable,
    hasOverride: override !== null,
    isFrozen: false,
  }
}

/**
 * D-5's gate. An entry counts as already reported when it carries a freeze
 * record from a report other than the one being computed.
 */
export function isAlreadyReported(entry: ReportInputEntry, currentReportId: string | null): boolean {
  const frozen = entry.frozen
  if (!frozen) return false
  if (currentReportId && frozen.reportId === currentReportId) return false
  return true
}

function distinctRate(values: readonly ExactResolvedEntryValues[]): string | null {
  let rate: string | null = null
  let seen = false
  for (const value of values) {
    if (!value.isBillable) continue
    if (!seen) {
      rate = value.rateExact
      seen = true
      continue
    }
    const same = rate === null || value.rateExact === null
      ? rate === value.rateExact
      : parseDecimal(rate)!.eq(value.rateExact)
    if (!same) return null
  }
  return rate
}

/**
 * Live amounts round to the currency's decimals (D10); a frozen amount is summed
 * exactly as it was billed, so a closed report keeps totalling to what it froze.
 */
export function sumResolvedAmounts(
  values: readonly (Pick<ResolvedEntryValues, 'isFrozen' | 'amountExact'> & { amount?: number | null })[],
  amountDecimalPlaces: number,
): string {
  const amountOf = (value: (typeof values)[number]) => exactOrNull(value.amountExact, value.amount)
  const live = values.filter((value) => !value.isFrozen).map(amountOf)
  const frozen = values.flatMap((value) => {
    const parsed = value.isFrozen ? parseDecimal(amountOf(value)) : null
    return parsed ? [parsed] : []
  })
  return decimalToString(sumDecimals([sumAmountsExact(live, amountDecimalPlaces), ...frozen]))
}

type LineBucket = {
  key: string
  label: string
  values: ExactResolvedEntryValues[]
  children: Map<string, LineBucket>
}

function makeBucket(key: string, label: string): LineBucket {
  return { key, label, values: [], children: new Map() }
}

function bucketToLine(bucket: LineBucket, amountDecimalPlaces: number): ExactReportLine {
  const childLines = Array.from(bucket.children.values()).map((child) => bucketToLine(child, amountDecimalPlaces))
  // The parent line aggregates its own ENTRIES plus every child's entries — never
  // the child lines' amounts (risk R10). Because `sumAmounts` works in integer
  // cents, aggregating entries and aggregating already-summed children agree
  // exactly; entries are used so the rule is visible in the code.
  const allValues = collectValues(bucket)
  const rateExact = distinctRate(allValues)
  const amountExact = sumResolvedAmounts(allValues, amountDecimalPlaces)
  return {
    key: bucket.key,
    label: bucket.label,
    minutes: allValues.reduce((total, value) => total + value.minutes, 0),
    rate: numberOrNull(rateExact),
    rateExact,
    amount: decimalToNumber(amountExact),
    amountExact,
    entryCount: allValues.length,
    hasOverride: allValues.some((value) => value.hasOverride),
    children: childLines,
  }
}

function collectValues(bucket: LineBucket): ExactResolvedEntryValues[] {
  const values = [...bucket.values]
  for (const child of bucket.children.values()) values.push(...collectValues(child))
  return values
}

/**
 * Resolving the strategy once per computation keeps a stored id whose module has
 * been removed from silently producing a different sheet on every call.
 */
function resolveGroupingStrategy(grouping: ReportGrouping): ReportGroupingStrategy {
  const strategy = getReportGrouping(grouping) ?? getReportGrouping(DEFAULT_REPORT_GROUPING)
  if (!strategy) throw new Error('[internal] no report grouping strategy is registered')
  return strategy
}

/**
 * A grouping contributes three functions that run once per entry, once per line and
 * O(n log n) times per project, all in the middle of rendering a client-facing
 * sheet. A thrower in any of them used to abort the whole report; it now degrades to
 * the module default for that one call, so the sheet still renders — with the
 * grouping the module shipped rather than none at all. The default itself is exempt:
 * there is nothing left to fall back to, and it cannot be a contribution.
 */
function guardGrouping(strategy: ReportGroupingStrategy): ReportGroupingStrategy {
  if (isBuiltInReportGrouping(strategy.id)) return strategy
  const fallback = getReportGrouping(DEFAULT_REPORT_GROUPING)
  if (!fallback) throw new Error('[internal] no report grouping strategy is registered')
  const guard = <TResult>(run: () => TResult, recover: () => TResult): TResult =>
    runStrategy(REPORT_GROUPING_REGISTRY_ID, strategy.id, run, recover)
  return {
    ...strategy,
    groupOf: (entry) => guard(() => strategy.groupOf(entry), () => fallback.groupOf(entry)),
    labelOf: (key, ctx) => guard(() => strategy.labelOf(key, ctx), () => fallback.labelOf(key, ctx)),
    sort: (left, right) => guard(() => strategy.sort(left, right), () => fallback.sort(left, right)),
  }
}

export type ComputeReportTotalsInput = {
  entries: readonly ReportInputEntry[]
  projects: readonly ReportInputProject[]
  directory: ReportDirectory
  options: ReportTotalsOptions
  /** Excludes this report's OWN freeze records from the already-reported gate. */
  currentReportId?: string | null
  labels: {
    unassignedTask: string
    unassignedPerson: string
    nonbillableGroup: string
  }
}

export function computeReportTotals(input: ComputeReportTotalsInput): ExactReportTotals {
  const { entries, projects, directory, options, labels } = input
  const grouping = guardGrouping(resolveGroupingStrategy(options.grouping))
  const amountDecimalPlaces = options.amountDecimalPlaces ?? DEFAULT_STAFF_AMOUNT_DECIMAL_PLACES
  const toLine = (bucket: LineBucket) => bucketToLine(bucket, amountDecimalPlaces)
  const labelContext: ReportGroupingLabelContext = { directory, fallbacks: labels }
  const lineKeyFor = (entry: ReportInputEntry) => grouping.groupOf(entry)
  const labelFor = (key: string) => grouping.labelOf(key, labelContext)
  const currentReportId = input.currentReportId ?? null
  const projectById = new Map(projects.map((project) => [project.id, project]))
  const projectOrder = projects.map((project) => project.id)

  const alreadyReportedBySource = new Map<string, AlreadyReportedSource>()
  let alreadyReportedCount = 0
  let alreadyReportedMinutes = 0

  const billableBuckets = new Map<string, Map<string, LineBucket>>()
  const nonbillableValues: ExactResolvedEntryValues[] = []
  const nonbillableBuckets = new Map<string, LineBucket>()
  const projectValues = new Map<string, ExactResolvedEntryValues[]>()

  for (const entry of entries) {
    const skipped = isAlreadyReported(entry, currentReportId) && !options.includeAlreadyReported
    if (skipped) {
      const frozen = entry.frozen
      const minutes = finiteOrNull(frozen?.roundedMinutes ?? null) ?? effectiveMinutes(entry)
      alreadyReportedCount += 1
      alreadyReportedMinutes += minutes
      if (frozen) {
        const existing = alreadyReportedBySource.get(frozen.reportId)
        if (existing) {
          existing.entryCount += 1
          existing.minutes += minutes
        } else {
          alreadyReportedBySource.set(frozen.reportId, {
            reportId: frozen.reportId,
            reference: frozen.reference,
            title: frozen.title,
            entryCount: 1,
            minutes,
          })
        }
      }
      continue
    }

    const project = projectById.get(entry.timeProjectId) ?? null
    const values = resolveEntryValues(entry, project, amountDecimalPlaces)

    if (!values.isBillable) {
      // `exclude` drops non-billable time entirely; `separate` shows it in its own
      // group at zero so the client sees the full effort with an unambiguous total.
      if (options.nonbillableMode === 'exclude') continue
      nonbillableValues.push(values)
      const { key } = lineKeyFor(entry)
      const label = labelFor(key)
      let bucket = nonbillableBuckets.get(key)
      if (!bucket) {
        bucket = makeBucket(key, label)
        nonbillableBuckets.set(key, bucket)
      }
      bucket.values.push(values)
      continue
    }

    const perProject = projectValues.get(entry.timeProjectId) ?? []
    perProject.push(values)
    projectValues.set(entry.timeProjectId, perProject)

    let lines = billableBuckets.get(entry.timeProjectId)
    if (!lines) {
      lines = new Map<string, LineBucket>()
      billableBuckets.set(entry.timeProjectId, lines)
    }

    const { key, parentKey } = lineKeyFor(entry)
    if (parentKey) {
      let parent = lines.get(parentKey)
      if (!parent) {
        parent = makeBucket(parentKey, labelFor(parentKey))
        lines.set(parentKey, parent)
      }
      let child = parent.children.get(key)
      if (!child) {
        child = makeBucket(key, labelFor(key))
        parent.children.set(key, child)
      }
      child.values.push(values)
      continue
    }

    let bucket = lines.get(key)
    if (!bucket) {
      bucket = makeBucket(key, labelFor(key))
      lines.set(key, bucket)
    }
    bucket.values.push(values)
  }

  const groups: ExactReportGroup[] = []
  for (const projectId of projectOrder) {
    const values = projectValues.get(projectId)
    if (!values || values.length === 0) continue
    const project = projectById.get(projectId)
    const lines = Array.from((billableBuckets.get(projectId) ?? new Map<string, LineBucket>()).values()).map(toLine)
    lines.sort(grouping.sort)
    const groupRateExact = exactOrNull(project?.hourlyRateExact, project?.hourlyRate)
    // Exact sum of already-rounded entry amounts — never a re-derivation from
    // the group's minutes and rate, which would disagree the moment a line
    // carries an override.
    const groupAmountExact = sumResolvedAmounts(values, amountDecimalPlaces)
    groups.push({
      key: projectId,
      kind: 'project',
      label: project?.name ?? projectId,
      rate: numberOrNull(groupRateExact),
      rateExact: groupRateExact,
      minutes: values.reduce((total, value) => total + value.minutes, 0),
      amount: decimalToNumber(groupAmountExact),
      amountExact: groupAmountExact,
      entryCount: values.length,
      lines,
    })
  }

  if (nonbillableValues.length > 0) {
    const lines = Array.from(nonbillableBuckets.values()).map(toLine)
    lines.sort(grouping.sort)
    groups.push({
      key: '__nonbillable__',
      kind: 'nonbillable',
      label: labels.nonbillableGroup,
      rate: null,
      rateExact: null,
      minutes: nonbillableValues.reduce((total, value) => total + value.minutes, 0),
      amount: 0,
      amountExact: '0',
      entryCount: nonbillableValues.length,
      lines,
    })
  }

  const billableValues = Array.from(projectValues.values()).flat()
  const totalAmountExact = sumResolvedAmounts(billableValues, amountDecimalPlaces)

  return {
    groups,
    billableMinutes: billableValues.reduce((total, value) => total + value.minutes, 0),
    nonbillableMinutes: nonbillableValues.reduce((total, value) => total + value.minutes, 0),
    entryCount: billableValues.length + nonbillableValues.length,
    // The grand total is a sum over ENTRIES, so regrouping cannot move it.
    totalAmount: decimalToNumber(totalAmountExact),
    totalAmountExact,
    alreadyReportedCount,
    alreadyReportedMinutes,
    alreadyReportedIn: Array.from(alreadyReportedBySource.values()),
  }
}

/**
 * The entries a report actually covers, after D-5 and the non-billable mode have
 * been applied. Close writes one freeze record per entry this returns, so the
 * set that is frozen is by construction the same set the sheet printed — the two
 * cannot drift.
 */
export function selectIncludedEntries(
  entries: readonly ReportInputEntry[],
  options: ReportTotalsOptions,
  currentReportId: string | null = null,
): ReportInputEntry[] {
  const included: ReportInputEntry[] = []
  for (const entry of entries) {
    if (isAlreadyReported(entry, currentReportId) && !options.includeAlreadyReported) continue
    // A frozen entry's billable flag is the frozen one, matching what
    // `resolveEntryValues` reads, so the two never disagree about which group a
    // re-included entry belongs to.
    const billable = entry.frozen ? entry.frozen.isBillable : entry.isBillable
    if (!billable && options.nonbillableMode === 'exclude') continue
    included.push(entry)
  }
  return included
}

export type CurrencyConflictProject = {
  id: string
  name: string
  currencyCode: string | null
}

export type ReportCurrencyResolution =
  | { ok: true; currencyCode: string | null }
  | { ok: false; currencies: string[]; offenders: CurrencyConflictProject[] }

/**
 * Risk R2: a report never sums across currencies. Currency codes are stored
 * upper-cased at the validator boundary (watch item W6), so this comparison is a
 * plain equality rather than a case-insensitive one; the normalization is
 * repeated here anyway because a row written before W6 closed would otherwise
 * read as a second currency.
 */
export function resolveReportCurrency(
  projects: readonly CurrencyConflictProject[],
): ReportCurrencyResolution {
  const byCurrency = new Map<string, CurrencyConflictProject[]>()
  for (const project of projects) {
    const code = typeof project.currencyCode === 'string' ? project.currencyCode.trim().toUpperCase() : ''
    if (!code) continue
    const bucket = byCurrency.get(code)
    if (bucket) bucket.push(project)
    else byCurrency.set(code, [project])
  }
  if (byCurrency.size > 1) {
    return {
      ok: false,
      currencies: Array.from(byCurrency.keys()).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      offenders: Array.from(byCurrency.values()).flat(),
    }
  }
  const [only] = Array.from(byCurrency.keys())
  return { ok: true, currencyCode: only ?? null }
}

/** Formats `385` as `6:25`, the `t-mono` duration the report sheet prints. */
export function formatReportMinutes(minutes: number): string {
  const safe = Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0
  const hours = Math.floor(safe / 60)
  const rest = safe % 60
  return `${hours}:${String(rest).padStart(2, '0')}`
}

export { round2, sumAmounts }
