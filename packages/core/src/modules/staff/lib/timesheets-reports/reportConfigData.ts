/**
 * Client-side shapes for the report config screen (13) and the preview endpoint
 * that feeds it. Kept out of the page component so the parsing is unit-testable
 * without mounting React.
 */

export type ReportCandidateProject = {
  id: string
  name: string
  hourlyRate: number | null
  currencyCode: string | null
}

export type PreviewProjectRow = {
  id: string
  name: string
  hourlyRate: number | null
  currencyCode: string | null
  entryCount: number
  billableMinutes: number
  nonbillableMinutes: number
  amount: number | null
}

export type PreviewAlreadyReportedSource = {
  reportId: string
  reference: string | null
  title: string | null
  entryCount: number
  minutes: number
}

export type PreviewLine = {
  key: string
  label: string
  minutes: number
  rate: number | null
  amount: number
  entryCount: number
  hasOverride: boolean
  children: PreviewLine[]
}

export type PreviewGroup = {
  key: string
  kind: 'project' | 'nonbillable'
  label: string
  rate: number | null
  minutes: number
  amount: number
  entryCount: number
  lines: PreviewLine[]
}

export type ReportPreview = {
  currencyCode: string | null
  grouping: 'project_task' | 'project_person' | 'project_day'
  nonbillableMode: 'separate' | 'exclude'
  includeAlreadyReported: boolean
  showRates: boolean
  projects: PreviewProjectRow[]
  groups: PreviewGroup[]
  totals: {
    entryCount: number
    billableMinutes: number
    nonbillableMinutes: number
    totalAmount: number | null
  }
  alreadyReportedCount: number
  alreadyReportedMinutes: number
  alreadyReportedIn: PreviewAlreadyReportedSource[]
  rounding: { unitMinutes: number; direction: string }
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export function readNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** Maps a `/time-projects` list row onto the pick-list's candidate shape. */
export function toCandidateProject(row: Record<string, unknown>): ReportCandidateProject | null {
  const id = readString(row.id)
  if (!id) return null
  return {
    id,
    name: readString(row.name) ?? readString(row.code) ?? id,
    hourlyRate: readNumber(row.hourly_rate ?? row.hourlyRate),
    currencyCode: readString(row.currency_code ?? row.currencyCode),
  }
}

function toLine(raw: unknown): PreviewLine | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const key = readString(row.key)
  if (key === null) return null
  return {
    key,
    label: readString(row.label) ?? key,
    minutes: readNumber(row.minutes) ?? 0,
    rate: readNumber(row.rate),
    amount: readNumber(row.amount) ?? 0,
    entryCount: readNumber(row.entryCount) ?? 0,
    hasOverride: row.hasOverride === true,
    children: Array.isArray(row.children)
      ? row.children.map(toLine).filter((line): line is PreviewLine => line !== null)
      : [],
  }
}

/**
 * Defensive because the preview response is money the screen renders verbatim:
 * a shape surprise must yield an empty sheet, never a plausible-looking wrong
 * number. Missing amounts read as `null` and are rendered as "—".
 */
export function parseReportPreview(payload: unknown): ReportPreview | null {
  if (!payload || typeof payload !== 'object') return null
  const row = payload as Record<string, unknown>
  const totalsRaw = (row.totals ?? {}) as Record<string, unknown>
  const roundingRaw = (row.rounding ?? {}) as Record<string, unknown>
  const grouping = row.grouping
  const nonbillableMode = row.nonbillableMode

  return {
    currencyCode: readString(row.currencyCode),
    grouping:
      grouping === 'project_person' || grouping === 'project_day' ? grouping : 'project_task',
    nonbillableMode: nonbillableMode === 'exclude' ? 'exclude' : 'separate',
    includeAlreadyReported: row.includeAlreadyReported === true,
    showRates: row.showRates === true,
    projects: Array.isArray(row.projects)
      ? row.projects
          .map((entry) => {
            if (!entry || typeof entry !== 'object') return null
            const project = entry as Record<string, unknown>
            const id = readString(project.id)
            if (!id) return null
            return {
              id,
              name: readString(project.name) ?? id,
              hourlyRate: readNumber(project.hourlyRate),
              currencyCode: readString(project.currencyCode),
              entryCount: readNumber(project.entryCount) ?? 0,
              billableMinutes: readNumber(project.billableMinutes) ?? 0,
              nonbillableMinutes: readNumber(project.nonbillableMinutes) ?? 0,
              amount: readNumber(project.amount),
            } satisfies PreviewProjectRow
          })
          .filter((project): project is PreviewProjectRow => project !== null)
      : [],
    groups: Array.isArray(row.groups)
      ? row.groups
          .map((entry) => {
            if (!entry || typeof entry !== 'object') return null
            const group = entry as Record<string, unknown>
            const key = readString(group.key)
            if (key === null) return null
            return {
              key,
              kind: group.kind === 'nonbillable' ? 'nonbillable' : 'project',
              label: readString(group.label) ?? key,
              rate: readNumber(group.rate),
              minutes: readNumber(group.minutes) ?? 0,
              amount: readNumber(group.amount) ?? 0,
              entryCount: readNumber(group.entryCount) ?? 0,
              lines: Array.isArray(group.lines)
                ? group.lines.map(toLine).filter((line): line is PreviewLine => line !== null)
                : [],
            } satisfies PreviewGroup
          })
          .filter((group): group is PreviewGroup => group !== null)
      : [],
    totals: {
      entryCount: readNumber(totalsRaw.entryCount) ?? 0,
      billableMinutes: readNumber(totalsRaw.billableMinutes) ?? 0,
      nonbillableMinutes: readNumber(totalsRaw.nonbillableMinutes) ?? 0,
      totalAmount: readNumber(totalsRaw.totalAmount),
    },
    alreadyReportedCount: readNumber(row.alreadyReportedCount) ?? 0,
    alreadyReportedMinutes: readNumber(row.alreadyReportedMinutes) ?? 0,
    alreadyReportedIn: Array.isArray(row.alreadyReportedIn)
      ? row.alreadyReportedIn
          .map((entry) => {
            if (!entry || typeof entry !== 'object') return null
            const source = entry as Record<string, unknown>
            const reportId = readString(source.reportId)
            if (!reportId) return null
            return {
              reportId,
              reference: readString(source.reference),
              title: readString(source.title),
              entryCount: readNumber(source.entryCount) ?? 0,
              minutes: readNumber(source.minutes) ?? 0,
            } satisfies PreviewAlreadyReportedSource
          })
          .filter((source): source is PreviewAlreadyReportedSource => source !== null)
      : [],
    rounding: {
      unitMinutes: readNumber(roundingRaw.unitMinutes) ?? 0,
      direction: readString(roundingRaw.direction) ?? 'up',
    },
  }
}

export type CurrencyConflict = {
  currencies: string[]
  offenders: Array<{ id: string; name: string; currencyCode: string | null }>
}

/**
 * Risk R2 surfaced rather than swallowed. The server refuses a mixed selection
 * with `422 report_currency_conflict`; the screen has to be able to say WHICH
 * projects disagree, or the user is left toggling checkboxes at random.
 */
export function readCurrencyConflict(error: unknown): CurrencyConflict | null {
  const body = (error as { body?: unknown } | null)?.body ?? error
  if (!body || typeof body !== 'object') return null
  const row = body as Record<string, unknown>
  if (row.code !== 'report_currency_conflict') return null
  const currencies = Array.isArray(row.currencies)
    ? row.currencies.filter((code): code is string => typeof code === 'string')
    : []
  const offenders = Array.isArray(row.offenders)
    ? row.offenders
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return null
          const offender = entry as Record<string, unknown>
          const id = readString(offender.id)
          if (!id) return null
          return {
            id,
            name: readString(offender.name) ?? id,
            currencyCode: readString(offender.currencyCode),
          }
        })
        .filter((offender): offender is CurrencyConflict['offenders'][number] => offender !== null)
    : []
  return { currencies, offenders }
}
