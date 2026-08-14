import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { emitCrudSideEffects, flushCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { StaffTimeEntry, StaffTeamMember, StaffTimeProject, StaffTimeTask } from '../../../../data/entities'
import {
  staffTimeEntryBulkSaveSchema,
  type StaffTimeEntryBulkSaveInput,
} from '../../../../data/validators'
import {
  buildTimeEntryLockedError,
  rebaseTimeEntryIntervalToDate,
  reconcileTimeEntryInterval,
  resolveTimeEntryBillable,
  resolveTimeEntryNotesInput,
  resolveTimeEntryProjectId,
  resolveTimeEntrySettings,
  roundedMinutesFor,
  timeEntryTaskMatchesProject,
  toStoredTimeEntryRateOverride,
  type LockedTimeEntryRef,
} from '../../../../commands/timesheets-entries'
import { staffTimeEntryCrudEvents } from '../../../../lib/crud'
import { invalidateStaffTimeEntryCache } from '../../../../lib/timesheets/timeEntryCacheInvalidation'
import {
  resolveUserFeatures,
  runStaffMutationGuardAfterSuccess,
  runStaffMutationGuards,
} from '../../../guards'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('staff')

/**
 * A grid cell is addressed by the day the work started, never by the timestamp,
 * so both sides of the comparison collapse to `YYYY-MM-DD` (D-8).
 */
function cellDateKey(value: Date | string | null | undefined): string {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 10)
}

type BulkRowError = { path: string; message: string; value?: unknown }

/**
 * The batch answers with a per-row error list rather than a thrown 422: one grid
 * save spans a week of cells, so the client needs to know WHICH row it must fix.
 * The single-entry command raises the same refusals as `CrudHttpError` field
 * errors — same rule, different reporting shape.
 */
function bulkValidationError(errors: BulkRowError[]): NextResponse {
  return NextResponse.json({ ok: false, errors }, { status: 422 })
}

/**
 * A row as the write loop needs it: the payload plus the two things that must be
 * settled before the lock gate can address a cell — the task it names (validated
 * in scope) and the project the entry actually lands on, which a task-only row
 * inherits from its task exactly as the single-entry path does.
 */
type BulkEntryInput = StaffTimeEntryBulkSaveInput['entries'][number]

type ResolvedBulkRow = {
  entry: BulkEntryInput
  task: { id: string; timeProjectId: string } | null
  timeProjectId: string
}

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['staff.timesheets.manage_own'] },
}

export async function POST(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()
    if (!auth) throw new CrudHttpError(401, { error: translate('staff.errors.unauthorized', 'Unauthorized') })

    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const tenantId = scope?.tenantId ?? auth.tenantId ?? null
    const organizationId = scope?.selectedId ?? auth.orgId ?? null
    if (!tenantId || !organizationId) {
      throw new CrudHttpError(400, { error: translate('staff.errors.missingScope', 'Missing tenant or organization scope.') })
    }

    const body = await readJsonSafe(req, {})
    const parsed = staffTimeEntryBulkSaveSchema.safeParse(body)
    if (!parsed.success) {
      const errors = parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }))
      return NextResponse.json({ ok: false, errors }, { status: 422 })
    }

    const { entries } = parsed.data

    // Tags are REFUSED here rather than accepted and dropped.
    //
    // The single-entry path assigns tags by dispatching the tag commands, which
    // fork their own EntityManager so they can carry their own audit entry, undo
    // and lock check. Inside this route's `em.transactional` that fork would not
    // see the rows the transaction has not committed yet, and dispatching AFTER
    // the commit would answer `{ ok: true, created: n }` for a batch whose tags
    // silently failed — a response carrying only counts cannot say which cell
    // lost them, which is the very silent-success class this route is being
    // fixed for. So the row is rejected and the user is pointed at the entry
    // dialog, which writes tags through the commands with all of their
    // guarantees intact.
    const taggedRows = entries.filter((entry) => entry.tagIds !== undefined)
    if (taggedRows.length > 0) {
      const message = translate(
        'staff.timesheets.errors.bulkTagsUnsupported',
        'Tags cannot be changed from the timesheet grid. Open the time entry to edit its tags.',
      )
      return bulkValidationError(taggedRows.map(() => ({ path: 'entries[].tagIds', message })))
    }

    const em = (container.resolve('em') as EntityManager).fork()
    const scopeCtx = { tenantId, organizationId }

    const staffMember = await findOneWithDecryption(
      em,
      StaffTeamMember,
      { userId: auth.sub, tenantId, organizationId, deletedAt: null },
      {},
      scopeCtx,
    )
    if (!staffMember) {
      throw new CrudHttpError(403, { error: translate('staff.timesheets.errors.noStaffMember', 'No staff member linked to your account.') })
    }
    const staffMemberId = staffMember.id

    // Validate that all referenced taskIds exist and are in-scope, in one query
    // for the whole batch. Same rule the single-entry path applies through
    // `requireTaskInScope`: a dangling task reference is refused rather than
    // stored, because the task rollups aggregate entries by `task_id` and a stale
    // or foreign UUID would silently move hours onto another project's card.
    const referencedTaskIds = [
      ...new Set(
        entries
          .map((entry) => entry.taskId)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    ]
    const tasksById = new Map<string, { id: string; timeProjectId: string }>()
    if (referencedTaskIds.length > 0) {
      const validTasks = await em.find(StaffTimeTask, {
        id: { $in: referencedTaskIds },
        tenantId,
        organizationId,
        deletedAt: null,
      }, { fields: ['id', 'timeProjectId'] })
      for (const task of validTasks) tasksById.set(task.id, { id: task.id, timeProjectId: task.timeProjectId })
      const invalidTaskIds = referencedTaskIds.filter((id) => !tasksById.has(id))
      if (invalidTaskIds.length > 0) {
        const message = translate('staff.timesheets.errors.taskNotFound', 'Task not found or not accessible.')
        return bulkValidationError(
          invalidTaskIds.map((id) => ({ path: 'entries[].taskId', message, value: id })),
        )
      }
    }

    // Every row is pinned to the project it will actually land on BEFORE the lock
    // gate runs, because the gate addresses a cell by (project, date) — a task row
    // that inherited its project must be checked against that inherited cell, not
    // against a blank one.
    const resolvedRows: ResolvedBulkRow[] = []
    const missingProjectErrors: BulkRowError[] = []
    const taskProjectMismatchErrors: BulkRowError[] = []
    for (const entry of entries) {
      const task = entry.taskId ? tasksById.get(entry.taskId) ?? null : null
      const timeProjectId = resolveTimeEntryProjectId(entry.timeProjectId, task)
      if (!timeProjectId) {
        missingProjectErrors.push({
          path: 'entries[].timeProjectId',
          message: translate('staff.timesheets.errors.projectRequired', 'Time project id is required.'),
        })
        continue
      }
      if (!timeEntryTaskMatchesProject(task, timeProjectId)) {
        taskProjectMismatchErrors.push({
          path: 'entries[].taskId',
          message: translate('staff.timesheets.errors.taskNotFound', 'Task not found or not accessible.'),
          value: entry.taskId,
        })
        continue
      }
      resolvedRows.push({ entry, task, timeProjectId })
    }
    if (missingProjectErrors.length > 0 || taskProjectMismatchErrors.length > 0) {
      return bulkValidationError([...missingProjectErrors, ...taskProjectMismatchErrors])
    }

    // Validate that all referenced timeProjectIds exist and are in-scope. The
    // project rows are kept, not just their ids: a created entry snapshots the
    // project's currency and inherits its billable default (D-3), so one query
    // serves validation and both defaults.
    const referencedProjectIds = [...new Set(resolvedRows.map((row) => row.timeProjectId))]
    const projectsById = new Map<string, { currencyCode?: string | null; billableByDefault?: boolean | null }>()
    if (referencedProjectIds.length > 0) {
      const validProjects = await em.find(StaffTimeProject, {
        id: { $in: referencedProjectIds },
        tenantId,
        organizationId,
        deletedAt: null,
      }, { fields: ['id', 'currencyCode', 'billableByDefault'] })
      for (const project of validProjects) {
        projectsById.set(project.id, {
          currencyCode: project.currencyCode ?? null,
          billableByDefault: project.billableByDefault ?? null,
        })
      }
      const invalidIds = referencedProjectIds.filter((id) => !projectsById.has(id))
      if (invalidIds.length > 0) {
        const message = translate(
          'staff.timesheets.errors.projectNotFound',
          'Time project not found or not accessible.',
        )
        return bulkValidationError(
          invalidIds.map((id) => ({ path: 'entries[].timeProjectId', message, value: id })),
        )
      }
    }

    const guardInput = {
      tenantId,
      organizationId,
      userId: auth.sub ?? '',
      resourceKind: 'staff.timesheets.time_entry',
      resourceId: staffMemberId,
      operation: 'update' as const,
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: parsed.data as unknown as Record<string, unknown>,
    }
    const guardResult = await runStaffMutationGuards(container, guardInput, resolveUserFeatures(auth))
    if (!guardResult.ok) {
      return NextResponse.json(
        guardResult.errorBody ?? { error: 'Operation blocked by guard' },
        { status: guardResult.errorStatus ?? 422 },
      )
    }

    const existingIds = resolvedRows
      .map((row) => row.entry.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)

    // Validate referenced entry IDs upfront: a stale or foreign UUID would
    // otherwise fall through to the create branch in the loop below and insert
    // a duplicate row with that ID-less new identity. Reject as 422 instead.
    if (existingIds.length > 0) {
      const resolvedExisting = await em.find(
        StaffTimeEntry,
        { id: { $in: existingIds }, tenantId, organizationId, staffMemberId, deletedAt: null },
        { fields: ['id'] },
      )
      const resolvedIdSet = new Set(resolvedExisting.map((entry) => entry.id))
      const invalidIds = existingIds.filter((id) => !resolvedIdSet.has(id))
      if (invalidIds.length > 0) {
        return NextResponse.json(
          {
            ok: false,
            errors: invalidIds.map((id) => ({
              path: 'entries[].id',
              message: translate(
                'staff.timesheets.errors.entryNotFound',
                'Time entry not found, deleted, or not owned by you.',
              ),
              value: id,
            })),
          },
          { status: 422 },
        )
      }
    }

    // --- Lock gate (risk R3) -------------------------------------------------
    //
    // This is the endpoint the lock is most likely to leak through, because the
    // grid addresses a cell by (project, date) and only carries an id when the
    // client happened to have one loaded. So both shapes are checked:
    //
    //  * a row naming an id that resolves to a frozen entry, and
    //  * an id-less row landing on a (project, date) cell a frozen entry already
    //    occupies — the grid renders one summed value per cell, so creating a
    //    second row there silently restates hours a closed report has billed.
    //
    // The batch fails WHOLESALE, before the transaction opens. A grid save is one
    // user gesture spanning a week of cells and the response carries only counts,
    // so applying the unlocked rows would leave the client unable to tell which
    // cells landed — and the route already rejects the whole payload for an
    // unknown project or a stale entry id, so a partial 409 would be the odd one
    // out. The 409 names every offending id and the reports that froze them, so
    // the grid can mark exactly those cells read-only and the user retries the
    // rest after reloading (which is also what makes the lock badge appear).
    //
    // The cell is addressed by the RESOLVED project, so a task row that inherited
    // its project is checked against the cell it will really occupy.
    const idlessRows = resolvedRows.filter((row) => !row.entry.id)
    const idlessCells = idlessRows.map((row) => `${cellDateKey(row.entry.date)}|${row.timeProjectId}`)
    const lockConditions: Record<string, unknown>[] = []
    if (existingIds.length > 0) lockConditions.push({ id: { $in: existingIds } })
    if (idlessCells.length > 0) {
      lockConditions.push({
        date: { $in: idlessRows.map((row) => row.entry.date) },
        timeProjectId: { $in: [...new Set(idlessRows.map((row) => row.timeProjectId))] },
      })
    }
    if (lockConditions.length > 0) {
      const existingIdSet = new Set(existingIds)
      const idlessCellSet = new Set(idlessCells)
      const lockedCandidates = await em.find(
        StaffTimeEntry,
        {
          tenantId,
          organizationId,
          staffMemberId,
          deletedAt: null,
          lockedReportId: { $ne: null },
          $or: lockConditions,
        },
        { fields: ['id', 'lockedReportId', 'date', 'timeProjectId'] },
      )
      // The (date × project) condition above is a cross product, so it can match a
      // locked entry on a cell the payload never touches — narrowed here.
      const blocked: LockedTimeEntryRef[] = lockedCandidates.filter(
        (row) =>
          existingIdSet.has(row.id) ||
          idlessCellSet.has(`${cellDateKey(row.date)}|${row.timeProjectId ?? ''}`),
      )
      if (blocked.length > 0) {
        throw buildTimeEntryLockedError(
          blocked.map((row) => ({ id: row.id, lockedReportId: row.lockedReportId })),
          translate,
        )
      }
    }

    type PendingChange = {
      action: 'created' | 'updated' | 'deleted'
      entity: StaffTimeEntry
    }

    // D-7 makes `rounded_minutes` the only input to cost, and this route writes
    // durations outside the entries command — so every row it touches is rounded
    // with the same tenant rule the command uses. The settings read is hoisted out
    // of the loop because it is tenant-scoped and identical for every row; the
    // billable default a created row falls back to comes from the same snapshot.
    const settings = await resolveTimeEntrySettings(container, tenantId)

    const { counts, pendingChanges } = await em.transactional(async (trx) => {
      let created = 0
      let updated = 0
      let deleted = 0
      const changes: PendingChange[] = []

      const existingEntries = existingIds.length > 0
        ? await findWithDecryption(
            trx,
            StaffTimeEntry,
            { id: { $in: existingIds }, tenantId, organizationId, staffMemberId, deletedAt: null },
            {},
            scopeCtx,
          )
        : []

      const existingMap = new Map(existingEntries.map((entry) => [entry.id, entry]))

      for (const { entry, task, timeProjectId } of resolvedRows) {
        const project = projectsById.get(timeProjectId) ?? null
        // Both branches read the five fields the schema has always accepted
        // through the SAME helpers the single-entry command uses, so a grid write
        // and a dialog write cannot settle them differently (#silent-no-op).
        const notes = resolveTimeEntryNotesInput(entry)
        if (entry.id && existingMap.has(entry.id)) {
          const existing = existingMap.get(entry.id)!
          if (entry.durationMinutes === 0) {
            existing.deletedAt = new Date()
            deleted++
            changes.push({ action: 'deleted', entity: existing })
          } else {
            // T4.10(a). A grid cell carries a duration and nothing else, so writing
            // it straight onto an entry that has clocks would store a two-hour
            // duration against a 09:00–10:00 span — exactly the contradiction the
            // single-entry path already refuses to store. The same reconciliation
            // is called here rather than re-derived: only-a-duration means
            // `started_at` anchors and `ended_at` shifts to match, a clock that
            // does not exist is never manufactured (so a cell whose entry has no
            // clocks keeps having none, and a running timer is not stopped), and a
            // re-dated row takes its clocks with it.
            const interval = reconcileTimeEntryInterval({
              stored: rebaseTimeEntryIntervalToDate({
                stored: {
                  startedAt: existing.startedAt ?? null,
                  endedAt: existing.endedAt ?? null,
                  durationMinutes: existing.durationMinutes,
                },
                fromDate: existing.date,
                toDate: entry.date,
              }),
              startedAt: undefined,
              endedAt: undefined,
              durationMinutes: entry.durationMinutes,
            })
            const projectChanged = timeProjectId !== (existing.timeProjectId ?? null)
            existing.date = entry.date
            existing.timeProjectId = timeProjectId
            // Snapshotted, never joined at read time, so a later project currency
            // change cannot re-denominate money already reported (D-3) — and only
            // restated when the entry actually moves between projects, exactly as
            // the single-entry update command does it.
            if (projectChanged) existing.rateCurrencyCode = project?.currencyCode ?? null
            existing.startedAt = interval.startedAt
            existing.endedAt = interval.endedAt
            existing.durationMinutes = interval.durationMinutes
            // D-7 keeps `rounded_minutes` the only input to cost, so it is restated
            // from the effective duration the reconciliation settled on.
            existing.roundedMinutes = roundedMinutesFor(interval.durationMinutes, settings)
            if (entry.taskId !== undefined) existing.taskId = task?.id ?? null
            if (entry.isBillable !== undefined) existing.isBillable = entry.isBillable
            if (entry.rateOverrideAmount !== undefined) {
              existing.rateOverrideAmount = toStoredTimeEntryRateOverride(entry.rateOverrideAmount)
            }
            if (notes !== undefined) existing.notes = notes
            existing.updatedAt = new Date()
            updated++
            changes.push({ action: 'updated', entity: existing })
          }
        } else {
          const now = new Date()
          const newEntry = trx.create(StaffTimeEntry, {
            tenantId,
            organizationId,
            staffMemberId,
            date: entry.date,
            timeProjectId,
            taskId: task?.id ?? null,
            durationMinutes: entry.durationMinutes,
            roundedMinutes: roundedMinutesFor(entry.durationMinutes, settings),
            notes: notes ?? null,
            isBillable: resolveTimeEntryBillable({ requested: entry.isBillable, project, settings }),
            rateOverrideAmount: toStoredTimeEntryRateOverride(entry.rateOverrideAmount),
            rateCurrencyCode: project?.currencyCode ?? null,
            source: 'manual',
            createdAt: now,
            updatedAt: now,
          })
          created++
          changes.push({ action: 'created', entity: newEntry })
        }
      }

      await trx.flush()
      return { counts: { created, updated, deleted }, pendingChanges: changes }
    })

    const dataEngine = container.resolve<DataEngine>('dataEngine')
    for (const change of pendingChanges) {
      await emitCrudSideEffects({
        dataEngine,
        action: change.action,
        entity: change.entity,
        identifiers: {
          id: change.entity.id,
          organizationId: change.entity.organizationId,
          tenantId: change.entity.tenantId,
        },
        events: staffTimeEntryCrudEvents,
      })
    }
    await flushCrudSideEffects(dataEngine)

    const invalidatedRecordIds = new Set<string>()
    for (const change of pendingChanges) {
      if (invalidatedRecordIds.has(change.entity.id)) continue
      invalidatedRecordIds.add(change.entity.id)
      await invalidateStaffTimeEntryCache(
        container,
        {
          id: change.entity.id,
          organizationId: change.entity.organizationId,
          tenantId: change.entity.tenantId,
        },
        tenantId,
        `bulk:${change.action}`,
      )
    }

    if (guardResult.afterSuccessCallbacks.length) {
      await runStaffMutationGuardAfterSuccess(guardResult.afterSuccessCallbacks, {
        tenantId,
        organizationId,
        userId: auth.sub ?? '',
        resourceKind: 'staff.timesheets.time_entry',
        resourceId: staffMemberId,
        operation: 'update',
        requestMethod: req.method,
        requestHeaders: req.headers,
      })
    }

    return NextResponse.json({ ok: true, ...counts }, { status: 200 })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    logger.error('staff.timesheets.time-entries.bulk failed', { err })
    return NextResponse.json(
      { error: translate('staff.timesheets.errors.bulkSave', 'Failed to bulk save time entries.') },
      { status: 400 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'Bulk save time entries',
  methods: {
    POST: {
      summary: 'Bulk save time entries',
      description:
        'Creates, updates, or soft-deletes multiple time entries in a single request. Entries with durationMinutes=0 and an existing id are soft-deleted. A row may name a taskId and let timeProjectId follow from it; task, description/notes precedence, isBillable defaulting, the rate override and the project currency snapshot follow the single-entry path exactly. tagIds is rejected with 422 — tags are edited from the time entry itself so their audit trail and undo stay intact. The whole batch is rejected with 409 time_entry_locked when any row targets — by id, or by landing on its (project, date) cell — an entry frozen in a closed report.',
      requestBody: {
        contentType: 'application/json',
        schema: staffTimeEntryBulkSaveSchema,
      },
      responses: [
        {
          status: 200,
          description: 'Bulk save completed',
          schema: z.object({
            ok: z.literal(true),
            created: z.number(),
            updated: z.number(),
            deleted: z.number(),
          }),
        },
        {
          status: 422,
          description: 'Validation error',
          schema: z.object({
            ok: z.literal(false),
            errors: z.array(z.object({ path: z.string(), message: z.string() })),
          }),
        },
        {
          status: 409,
          description: 'One or more rows target a time entry locked in a closed report; nothing was saved',
          schema: z.object({
            code: z.literal('time_entry_locked'),
            error: z.string(),
            lockedReportId: z.string().uuid().nullable(),
            lockedEntryIds: z.array(z.string().uuid()),
            lockedReportIds: z.array(z.string().uuid()),
          }),
        },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Forbidden', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
