/**
 * The consulting-suite response fields on a time-entry row.
 *
 * This used to be a route-private `hooks.afterList` on
 * `/api/staff/timesheets/time-entries`, which made it invisible to the extension
 * system: a third-party enricher for `staff:staff_time_entry` could not see what
 * the hook had already added, and could not compose with it. The logic lives here so
 * the declared enricher in `data/enrichers.ts` owns it and the route keeps only its
 * deprecated wrapper.
 *
 * Money is ADDED for a caller holding `staff.timesheets.rates.view` and is stripped
 * for everyone else — `cost`, `currencyCode` and the stored rate override are absent
 * from the payload rather than blanked, which is the module-wide rule
 * (`staff/AGENTS.md` → ACL feature IDs).
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import { StaffTimeEntryTag, StaffTimeProject, StaffTimeTag } from '../../data/entities'
import { entryAmount } from '../time-tracking/cost'

export type TimeEntryTagSummary = {
  id: string
  slug: string
  label: string
  color: string | null
}

export type TimeEntryDecorationScope = {
  em: EntityManager
  tenantId: string | null
  organizationId: string | null
  canSeeRates: boolean
  /** Called with a decoration failure; the rows themselves are already correct and scoped. */
  onError?: (err: unknown) => void
}

type EntryRow = Record<string, unknown>

const FIELD = {
  id: ['id', 'id'],
  roundedMinutes: ['rounded_minutes', 'roundedMinutes'],
  notes: ['notes', 'notes'],
  timeProjectId: ['time_project_id', 'timeProjectId'],
  isBillable: ['is_billable', 'isBillable'],
  rateOverrideAmount: ['rate_override_amount', 'rateOverrideAmount'],
  rateCurrencyCode: ['rate_currency_code', 'rateCurrencyCode'],
  lockedReportId: ['locked_report_id', 'lockedReportId'],
} as const

function readValue(row: EntryRow, field: readonly [string, string]): unknown {
  const snake = row[field[0]]
  if (snake !== undefined) return snake
  return row[field[1]]
}

function toNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (value === 'true' || value === 1) return true
  if (value === 'false' || value === 0) return false
  return fallback
}

async function loadEntryTags(
  em: EntityManager,
  entryIds: string[],
  tenantId: string,
  organizationId: string,
): Promise<Map<string, TimeEntryTagSummary[]>> {
  const byEntryId = new Map<string, TimeEntryTagSummary[]>()
  if (entryIds.length === 0) return byEntryId
  const assignments = await em.find(StaffTimeEntryTag, {
    timeEntryId: { $in: entryIds },
    tenantId,
    organizationId,
  })
  if (assignments.length === 0) return byEntryId
  const tags = await em.find(StaffTimeTag, {
    id: { $in: Array.from(new Set(assignments.map((row) => row.tagId))) },
    tenantId,
    organizationId,
    deletedAt: null,
  })
  const tagById = new Map(tags.map((tag) => [tag.id, tag]))
  for (const assignment of assignments) {
    const tag = tagById.get(assignment.tagId)
    if (!tag) continue
    const list = byEntryId.get(assignment.timeEntryId) ?? []
    list.push({ id: tag.id, slug: tag.slug, label: tag.label, color: tag.color ?? null })
    byEntryId.set(assignment.timeEntryId, list)
  }
  return byEntryId
}

type ProjectMoney = { hourlyRate: number | null; currencyCode: string | null }

async function loadProjectMoney(
  em: EntityManager,
  projectIds: string[],
  tenantId: string,
  organizationId: string,
): Promise<Map<string, ProjectMoney>> {
  const byId = new Map<string, ProjectMoney>()
  if (projectIds.length === 0) return byId
  const projects = await em.find(StaffTimeProject, {
    id: { $in: projectIds },
    tenantId,
    organizationId,
    deletedAt: null,
  })
  for (const project of projects) {
    byId.set(project.id, {
      hourlyRate: toNullableNumber(project.hourlyRate),
      currencyCode: toNullableString(project.currencyCode),
    })
  }
  return byId
}

/**
 * Decorates the given rows IN PLACE. Callers that must not touch their input pass
 * shallow copies — which is what the enricher does, so its contract stays additive.
 */
export async function decorateTimeEntryRows(
  rows: EntryRow[],
  scope: TimeEntryDecorationScope,
): Promise<void> {
  if (rows.length === 0) return

  const { tenantId, organizationId, canSeeRates } = scope
  let tagsByEntryId = new Map<string, TimeEntryTagSummary[]>()
  let moneyByProjectId = new Map<string, ProjectMoney>()

  if (tenantId && organizationId) {
    try {
      const em = scope.em.fork()
      const entryIds = rows
        .map((row) => readValue(row, FIELD.id))
        .filter((value): value is string => typeof value === 'string')
      tagsByEntryId = await loadEntryTags(em, entryIds, tenantId, organizationId)
      if (canSeeRates) {
        const projectIds = Array.from(
          new Set(
            rows
              .map((row) => readValue(row, FIELD.timeProjectId))
              .filter((value): value is string => typeof value === 'string'),
          ),
        )
        moneyByProjectId = await loadProjectMoney(em, projectIds, tenantId, organizationId)
      }
    } catch (err) {
      // A decoration failure must not fail the list; the entry rows themselves are
      // already correct and scoped.
      scope.onError?.(err)
    }
  }

  for (const row of rows) {
    const entryId = readValue(row, FIELD.id)
    const lockedReportId = toNullableString(readValue(row, FIELD.lockedReportId))
    const roundedMinutes = toNullableNumber(readValue(row, FIELD.roundedMinutes))
    const isBillable = toBoolean(readValue(row, FIELD.isBillable), true)

    // The published alias: same value, second name, both keys returned.
    row.description = toNullableString(readValue(row, FIELD.notes))
    row.roundedMinutes = roundedMinutes
    row.isLocked = lockedReportId !== null
    row.lockedReportId = lockedReportId
    row.tags = typeof entryId === 'string' ? tagsByEntryId.get(entryId) ?? [] : []

    if (!canSeeRates) {
      delete row[FIELD.rateOverrideAmount[0]]
      delete row[FIELD.rateOverrideAmount[1]]
      delete row[FIELD.rateCurrencyCode[0]]
      delete row[FIELD.rateCurrencyCode[1]]
      continue
    }

    const projectId = readValue(row, FIELD.timeProjectId)
    const money = typeof projectId === 'string' ? moneyByProjectId.get(projectId) : undefined
    row.currencyCode = toNullableString(readValue(row, FIELD.rateCurrencyCode)) ?? money?.currencyCode ?? null
    // A non-billable entry has no price at all — `null`, never `0`, which would
    // read as free work rather than work that is out of scope.
    row.cost = entryAmount(
      {
        isBillable,
        roundedMinutes: roundedMinutes ?? 0,
        rateOverrideAmount: toNullableNumber(readValue(row, FIELD.rateOverrideAmount)),
      },
      { hourlyRate: money?.hourlyRate ?? null },
    )
  }
}
