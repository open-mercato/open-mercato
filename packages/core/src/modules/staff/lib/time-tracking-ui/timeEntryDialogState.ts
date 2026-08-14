import {
  deriveInterval,
  formatClock,
  parseClock,
  type ComputedIntervalField,
  type IntervalInput,
} from '../time-tracking/interval'

export type IntervalField = 'start' | 'end' | 'duration'

/**
 * The 2-of-3 state of screen 8. It keeps the three fields as the user left them
 * plus the answer `deriveInterval` gave for the third one, so the badge and the
 * hint can be read straight off the state instead of being recomputed in the
 * render path.
 */
export type TimeIntervalState = {
  /** Raw clock text, so half-typed input (`15:1`) is never rewritten. */
  startText: string
  endText: string
  durationMinutes: number | null
  /** `DurationInput` said the text does not parse — Save is blocked on this. */
  durationInvalid: boolean
  computed: ComputedIntervalField
  crossesMidnight: boolean
  /**
   * Bumped only when the *derived* duration changes. The dialog uses it as the
   * `key` of `DurationInput`, so a machine-filled duration re-renders while the
   * text the user is typing there is left alone.
   */
  durationEpoch: number
  lastEdited: IntervalField | null
}

export type TimeIntervalEdit =
  | { field: 'start'; value: string }
  | { field: 'end'; value: string }
  | { field: 'duration'; minutes: number | null; invalid: boolean }
  /** "Snap start to 13:30" — moves the start and keeps the duration. */
  | { field: 'snapStart'; value: string }

type RawInterval = {
  startText: string
  endText: string
  durationMinutes: number | null
}

/**
 * Which field yields when all three are filled. `start` is the anchor a person
 * thinks in, so editing the end restates the duration (screen 8 note 1) rather
 * than sliding the start backwards.
 */
const ANCHOR_PRIORITY: readonly IntervalField[] = ['start', 'end', 'duration']

function hasValue(raw: RawInterval, field: IntervalField): boolean {
  if (field === 'duration') return raw.durationMinutes !== null
  return parseClock(field === 'start' ? raw.startText : raw.endText) !== null
}

function chooseAnchors(raw: RawInterval, lastEdited: IntervalField | null): IntervalField[] {
  const present = ANCHOR_PRIORITY.filter((field) => hasValue(raw, field))
  if (present.length <= 2) return present
  if (!lastEdited) return present.slice(0, 2)
  const second = ANCHOR_PRIORITY.find((field) => field !== lastEdited && hasValue(raw, field))
  return second ? [lastEdited, second] : [lastEdited]
}

function buildInput(raw: RawInterval, anchors: readonly IntervalField[]): IntervalInput {
  const input: IntervalInput = {}
  if (anchors.includes('start')) input.start = raw.startText
  if (anchors.includes('end')) input.end = raw.endText
  // With both clocks anchored the duration is still handed over: `deriveInterval`
  // then answers `computed: null` for values that already agree, which is what
  // keeps a freshly loaded entry from opening with a spurious badge.
  if (anchors.includes('duration') || (anchors.includes('start') && anchors.includes('end'))) {
    input.durationMinutes = raw.durationMinutes
  }
  return input
}

function applyDerivation(
  raw: RawInterval,
  previous: TimeIntervalState,
  lastEdited: IntervalField | null,
  anchors: readonly IntervalField[],
): TimeIntervalState {
  const derived = deriveInterval(buildInput(raw, anchors))
  const durationMinutes = derived.computed === 'duration' ? derived.durationMinutes : raw.durationMinutes
  const durationChanged = derived.computed === 'duration' && durationMinutes !== previous.durationMinutes
  return {
    startText: derived.computed === 'start' && derived.start ? derived.start : raw.startText,
    endText: derived.computed === 'end' && derived.end ? derived.end : raw.endText,
    durationMinutes,
    durationInvalid: derived.computed === 'duration' ? false : previous.durationInvalid,
    computed: derived.computed,
    crossesMidnight: derived.crossesMidnight,
    durationEpoch: durationChanged ? previous.durationEpoch + 1 : previous.durationEpoch,
    lastEdited,
  }
}

const EMPTY_STATE: TimeIntervalState = {
  startText: '',
  endText: '',
  durationMinutes: null,
  durationInvalid: false,
  computed: null,
  crossesMidnight: false,
  durationEpoch: 0,
  lastEdited: null,
}

export function createIntervalState(seed: {
  start?: string | null
  end?: string | null
  durationMinutes?: number | null
}): TimeIntervalState {
  const raw: RawInterval = {
    startText: seed.start ?? '',
    endText: seed.end ?? '',
    durationMinutes: seed.durationMinutes ?? null,
  }
  return applyDerivation(raw, EMPTY_STATE, null, chooseAnchors(raw, null))
}

/**
 * Re-seeds the three fields for a different entry — or for the next one after
 * "save and add another" — and always advances `durationEpoch`, so the duration
 * field remounts and drops whatever text was left in it.
 */
export function resetIntervalState(
  previous: TimeIntervalState,
  seed: { start?: string | null; end?: string | null; durationMinutes?: number | null },
): TimeIntervalState {
  const next = createIntervalState(seed)
  return { ...next, durationEpoch: previous.durationEpoch + 1 }
}

export function reduceIntervalState(state: TimeIntervalState, edit: TimeIntervalEdit): TimeIntervalState {
  if (edit.field === 'snapStart') {
    const raw: RawInterval = { ...toRaw(state), startText: edit.value }
    // The suggestion moves the start and keeps the length of the work, so the
    // end is the field that follows — never the duration the user already typed.
    const anchors: IntervalField[] = raw.durationMinutes !== null ? ['start', 'duration'] : ['start', 'end']
    return applyDerivation(raw, state, 'start', anchors)
  }
  if (edit.field === 'duration') {
    const raw: RawInterval = { ...toRaw(state), durationMinutes: edit.minutes }
    const next = applyDerivation(raw, state, 'duration', chooseAnchors(raw, 'duration'))
    return { ...next, durationInvalid: edit.invalid }
  }
  const raw: RawInterval =
    edit.field === 'start'
      ? { ...toRaw(state), startText: edit.value }
      : { ...toRaw(state), endText: edit.value }
  return applyDerivation(raw, state, edit.field, chooseAnchors(raw, edit.field))
}

function toRaw(state: TimeIntervalState): RawInterval {
  return { startText: state.startText, endText: state.endText, durationMinutes: state.durationMinutes }
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

export function shiftIsoDate(date: string, days: number): string {
  const match = DATE_PATTERN.exec(date)
  if (!match) return date
  const shifted = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days))
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const day = String(shifted.getUTCDate()).padStart(2, '0')
  return `${shifted.getUTCFullYear()}-${month}-${day}`
}

export function todayIsoDate(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/**
 * Wall clock plus calendar day into the instant the API stores. `plusDays` is 1
 * for the end of an entry that crosses midnight (D-8): the work started on
 * `date` and finished the following calendar day.
 */
export function combineDateAndClock(date: string, clock: string, plusDays = 0): string | null {
  const match = DATE_PATTERN.exec(date)
  const minutesOfDay = parseClock(clock)
  if (!match || minutesOfDay === null) return null
  const composed = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]) + plusDays,
    Math.floor(minutesOfDay / 60),
    minutesOfDay % 60,
    0,
    0,
  )
  if (Number.isNaN(composed.getTime())) return null
  return composed.toISOString()
}

/** Accepts the wall clock the form sends and the timestamp the timer persists. */
export function clockFromApiValue(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) return ''
  const trimmed = value.trim()
  const direct = parseClock(trimmed)
  if (direct !== null) return formatClock(direct)
  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return ''
  return formatClock(parsed.getHours() * 60 + parsed.getMinutes())
}

export function dateFromApiValue(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) return ''
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim())
  if (match) return match[1]
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return todayIsoDate(parsed)
}

export type TimeEntryRecord = {
  id: string
  date: string
  startText: string
  endText: string
  durationMinutes: number | null
  description: string
  taskId: string | null
  timeProjectId: string | null
  isBillable: boolean
  rateOverrideAmount: number | null
  currencyCode: string | null
  tagIds: string[]
  isLocked: boolean
  lockedReportId: string | null
  updatedAt: string | null
}

export type ApiRow = Record<string, unknown>

export function readRowString(row: ApiRow, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  return null
}

export function readRowNumber(row: ApiRow, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return null
}

export function readRowBoolean(row: ApiRow, fallback: boolean, ...keys: string[]): boolean {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'boolean') return value
  }
  return fallback
}

export function readRowItems(payload: unknown): ApiRow[] {
  const items = (payload as { items?: unknown } | null)?.items
  return Array.isArray(items) ? (items.filter((item) => !!item && typeof item === 'object') as ApiRow[]) : []
}

export function toTimeEntryRecord(row: ApiRow): TimeEntryRecord | null {
  const id = readRowString(row, 'id')
  if (!id) return null
  const tags = Array.isArray(row.tags) ? row.tags : []
  return {
    id,
    date: dateFromApiValue(readRowString(row, 'date')),
    startText: clockFromApiValue(readRowString(row, 'started_at', 'startedAt')),
    endText: clockFromApiValue(readRowString(row, 'ended_at', 'endedAt')),
    durationMinutes: readRowNumber(row, 'duration_minutes', 'durationMinutes'),
    description: readRowString(row, 'description', 'notes') ?? '',
    taskId: readRowString(row, 'task_id', 'taskId'),
    timeProjectId: readRowString(row, 'time_project_id', 'timeProjectId'),
    isBillable: readRowBoolean(row, true, 'is_billable', 'isBillable'),
    rateOverrideAmount: readRowNumber(row, 'rate_override_amount', 'rateOverrideAmount'),
    currencyCode: readRowString(row, 'currencyCode', 'rate_currency_code', 'rateCurrencyCode'),
    tagIds: tags
      .map((tag) => (tag && typeof tag === 'object' ? readRowString(tag as ApiRow, 'id') : null))
      .filter((value): value is string => value !== null),
    isLocked: readRowBoolean(row, false, 'isLocked', 'is_locked'),
    lockedReportId: readRowString(row, 'lockedReportId', 'locked_report_id'),
    updatedAt: readRowString(row, 'updated_at', 'updatedAt'),
  }
}

export type TaskOption = {
  id: string
  title: string
  timeProjectId: string | null
}

export type ProjectOption = {
  id: string
  name: string
  customerName: string | null
  hourlyRate: number | null
  currencyCode: string | null
  billableByDefault: boolean | null
}

export function toTaskOption(row: ApiRow): TaskOption | null {
  const id = readRowString(row, 'id')
  const title = readRowString(row, 'title')
  if (!id || !title) return null
  return { id, title, timeProjectId: readRowString(row, 'time_project_id', 'timeProjectId') }
}

export function toProjectOption(row: ApiRow): ProjectOption | null {
  const id = readRowString(row, 'id')
  if (!id) return null
  const snapshot = row.customer_snapshot ?? row.customerSnapshot
  const customerName =
    snapshot && typeof snapshot === 'object' ? readRowString(snapshot as ApiRow, 'name', 'displayName') : null
  return {
    id,
    name: readRowString(row, 'name') ?? id,
    customerName,
    hourlyRate: readRowNumber(row, 'hourly_rate', 'hourlyRate'),
    currencyCode: readRowString(row, 'currency_code', 'currencyCode'),
    billableByDefault:
      typeof row.billable_by_default === 'boolean'
        ? row.billable_by_default
        : typeof row.billableByDefault === 'boolean'
          ? row.billableByDefault
          : null,
  }
}

/** `Migracja koszyka B2B — Nordvik — migracja B2B` (screen 8's task option). */
export function describeTaskOption(task: TaskOption, project: ProjectOption | null | undefined): string {
  return [task.title, project?.customerName ?? null, project?.name ?? null]
    .filter((part): part is string => !!part && part.trim().length > 0)
    .join(' — ')
}

export type OverlapEntry = {
  id: string
  startText: string
  endText: string
  durationMinutes: number
  taskTitle: string | null
  projectName: string | null
  description: string | null
}

export function toOverlapEntry(row: ApiRow): OverlapEntry | null {
  const id = readRowString(row, 'id')
  if (!id) return null
  return {
    id,
    startText: clockFromApiValue(readRowString(row, 'started_at', 'startedAt')),
    endText: clockFromApiValue(readRowString(row, 'ended_at', 'endedAt')),
    durationMinutes: readRowNumber(row, 'duration_minutes', 'durationMinutes') ?? 0,
    taskTitle: readRowString(row, 'task_title', 'taskTitle'),
    projectName: readRowString(row, 'project_name', 'projectName'),
    description: readRowString(row, 'notes', 'description'),
  }
}
