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

import { entryAmount, round2, sumAmounts } from '../time-tracking/cost'

export type ReportGrouping = 'project_task' | 'project_person' | 'project_day'
export type ReportNonBillableMode = 'separate' | 'exclude'

/** The freeze record of an entry already closed into an earlier report. */
export type FrozenEntryValues = {
  reportId: string
  reference: string | null
  title: string | null
  rawMinutes: number
  roundedMinutes: number
  rateAmount: number | null
  currencyCode: string | null
  amount: number | null
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
  description: string | null
  /** Present when this entry is already frozen in a closed report (D-5). */
  frozen: FrozenEntryValues | null
}

export type ReportInputProject = {
  id: string
  name: string
  hourlyRate: number | null
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
}

/** What one entry actually contributes, after D-5 and D-7 have been applied. */
export type ResolvedEntryValues = {
  entryId: string
  minutes: number
  rawMinutes: number
  rate: number | null
  amount: number | null
  isBillable: boolean
  hasOverride: boolean
  isFrozen: boolean
}

export type ReportLine = {
  key: string
  label: string
  minutes: number
  /** The rate every entry on this line agreed on, or null when they disagree. */
  rate: number | null
  amount: number
  entryCount: number
  hasOverride: boolean
  /** Child-task rollup detail (D-2); empty for person and day groupings. */
  children: ReportLine[]
}

export type ReportGroup = {
  key: string
  kind: 'project' | 'nonbillable'
  label: string
  rate: number | null
  minutes: number
  amount: number
  entryCount: number
  lines: ReportLine[]
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
  /** Entries skipped because they are frozen elsewhere (D-5). Zero when opted in. */
  alreadyReportedCount: number
  alreadyReportedMinutes: number
  alreadyReportedIn: AlreadyReportedSource[]
}

const UNASSIGNED_KEY = '__unassigned__'

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
export function resolveEntryValues(
  entry: ReportInputEntry,
  project: ReportInputProject | null | undefined,
): ResolvedEntryValues {
  const frozen = entry.frozen
  if (frozen) {
    return {
      entryId: entry.id,
      minutes: finiteOrNull(frozen.roundedMinutes) ?? 0,
      rawMinutes: finiteOrNull(frozen.rawMinutes) ?? 0,
      rate: finiteOrNull(frozen.rateAmount),
      amount: frozen.isBillable ? finiteOrNull(frozen.amount) : null,
      isBillable: frozen.isBillable,
      hasOverride: finiteOrNull(entry.rateOverrideAmount) !== null,
      isFrozen: true,
    }
  }

  const minutes = effectiveMinutes(entry)
  const override = finiteOrNull(entry.rateOverrideAmount)
  const projectRate = finiteOrNull(project?.hourlyRate ?? null)
  const rate = override ?? projectRate
  return {
    entryId: entry.id,
    minutes,
    rawMinutes: finiteOrNull(entry.durationMinutes) ?? 0,
    rate: entry.isBillable ? rate : null,
    amount: entryAmount(
      { isBillable: entry.isBillable, roundedMinutes: minutes, rateOverrideAmount: override },
      project ?? null,
    ),
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

function distinctRate(values: readonly ResolvedEntryValues[]): number | null {
  let rate: number | null = null
  let seen = false
  for (const value of values) {
    if (!value.isBillable) continue
    if (!seen) {
      rate = value.rate
      seen = true
      continue
    }
    if (value.rate !== rate) return null
  }
  return rate
}

type LineBucket = {
  key: string
  label: string
  values: ResolvedEntryValues[]
  children: Map<string, LineBucket>
}

function makeBucket(key: string, label: string): LineBucket {
  return { key, label, values: [], children: new Map() }
}

function bucketToLine(bucket: LineBucket): ReportLine {
  const childLines = Array.from(bucket.children.values()).map(bucketToLine)
  // The parent line aggregates its own ENTRIES plus every child's entries — never
  // the child lines' amounts (risk R10). Because `sumAmounts` works in integer
  // cents, aggregating entries and aggregating already-summed children agree
  // exactly; entries are used so the rule is visible in the code.
  const allValues = collectValues(bucket)
  return {
    key: bucket.key,
    label: bucket.label,
    minutes: allValues.reduce((total, value) => total + value.minutes, 0),
    rate: distinctRate(allValues),
    amount: sumAmounts(allValues.map((value) => value.amount)),
    entryCount: allValues.length,
    hasOverride: allValues.some((value) => value.hasOverride),
    children: childLines,
  }
}

function collectValues(bucket: LineBucket): ResolvedEntryValues[] {
  const values = [...bucket.values]
  for (const child of bucket.children.values()) values.push(...collectValues(child))
  return values
}

function lineKeyFor(
  entry: ReportInputEntry,
  grouping: ReportGrouping,
): { key: string; parentKey: string | null } {
  if (grouping === 'project_person') {
    return { key: entry.staffMemberId ?? UNASSIGNED_KEY, parentKey: null }
  }
  if (grouping === 'project_day') {
    return { key: entry.date || UNASSIGNED_KEY, parentKey: null }
  }
  const rootId = entry.rootTaskId ?? entry.taskId ?? null
  const taskId = entry.taskId ?? null
  if (!rootId) return { key: UNASSIGNED_KEY, parentKey: null }
  // D-2: a child's time lands on the parent's line and is expandable underneath.
  if (taskId && taskId !== rootId) return { key: taskId, parentKey: rootId }
  return { key: rootId, parentKey: null }
}

function labelFor(
  key: string,
  grouping: ReportGrouping,
  directory: ReportDirectory,
  fallbacks: { unassignedTask: string; unassignedPerson: string },
): string {
  if (key === UNASSIGNED_KEY) {
    return grouping === 'project_person' ? fallbacks.unassignedPerson : fallbacks.unassignedTask
  }
  if (grouping === 'project_person') return directory.personLabelById[key] ?? fallbacks.unassignedPerson
  if (grouping === 'project_day') return key
  return directory.taskLabelById[key] ?? fallbacks.unassignedTask
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

export function computeReportTotals(input: ComputeReportTotalsInput): ReportTotals {
  const { entries, projects, directory, options, labels } = input
  const currentReportId = input.currentReportId ?? null
  const projectById = new Map(projects.map((project) => [project.id, project]))
  const projectOrder = projects.map((project) => project.id)

  const alreadyReportedBySource = new Map<string, AlreadyReportedSource>()
  let alreadyReportedCount = 0
  let alreadyReportedMinutes = 0

  const billableBuckets = new Map<string, Map<string, LineBucket>>()
  const nonbillableValues: ResolvedEntryValues[] = []
  const nonbillableBuckets = new Map<string, LineBucket>()
  const projectValues = new Map<string, ResolvedEntryValues[]>()

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
    const values = resolveEntryValues(entry, project)

    if (!values.isBillable) {
      // `exclude` drops non-billable time entirely; `separate` shows it in its own
      // group at zero so the client sees the full effort with an unambiguous total.
      if (options.nonbillableMode === 'exclude') continue
      nonbillableValues.push(values)
      const { key } = lineKeyFor(entry, options.grouping)
      const label = labelFor(key, options.grouping, directory, labels)
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

    const { key, parentKey } = lineKeyFor(entry, options.grouping)
    if (parentKey) {
      let parent = lines.get(parentKey)
      if (!parent) {
        parent = makeBucket(parentKey, labelFor(parentKey, options.grouping, directory, labels))
        lines.set(parentKey, parent)
      }
      let child = parent.children.get(key)
      if (!child) {
        child = makeBucket(key, labelFor(key, options.grouping, directory, labels))
        parent.children.set(key, child)
      }
      child.values.push(values)
      continue
    }

    let bucket = lines.get(key)
    if (!bucket) {
      bucket = makeBucket(key, labelFor(key, options.grouping, directory, labels))
      lines.set(key, bucket)
    }
    bucket.values.push(values)
  }

  const groups: ReportGroup[] = []
  for (const projectId of projectOrder) {
    const values = projectValues.get(projectId)
    if (!values || values.length === 0) continue
    const project = projectById.get(projectId)
    const lines = Array.from((billableBuckets.get(projectId) ?? new Map<string, LineBucket>()).values()).map(
      bucketToLine,
    )
    lines.sort((left, right) => right.minutes - left.minutes || left.label.localeCompare(right.label))
    groups.push({
      key: projectId,
      kind: 'project',
      label: project?.name ?? projectId,
      rate: finiteOrNull(project?.hourlyRate ?? null),
      minutes: values.reduce((total, value) => total + value.minutes, 0),
      // Exact sum of already-rounded entry amounts — never a re-derivation from
      // the group's minutes and rate, which would disagree the moment a line
      // carries an override.
      amount: sumAmounts(values.map((value) => value.amount)),
      entryCount: values.length,
      lines,
    })
  }

  if (nonbillableValues.length > 0) {
    const lines = Array.from(nonbillableBuckets.values()).map(bucketToLine)
    lines.sort((left, right) => right.minutes - left.minutes || left.label.localeCompare(right.label))
    groups.push({
      key: '__nonbillable__',
      kind: 'nonbillable',
      label: labels.nonbillableGroup,
      rate: null,
      minutes: nonbillableValues.reduce((total, value) => total + value.minutes, 0),
      amount: 0,
      entryCount: nonbillableValues.length,
      lines,
    })
  }

  const billableValues = Array.from(projectValues.values()).flat()

  return {
    groups,
    billableMinutes: billableValues.reduce((total, value) => total + value.minutes, 0),
    nonbillableMinutes: nonbillableValues.reduce((total, value) => total + value.minutes, 0),
    entryCount: billableValues.length + nonbillableValues.length,
    // The grand total is a sum over ENTRIES, so regrouping cannot move it.
    totalAmount: sumAmounts(billableValues.map((value) => value.amount)),
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
