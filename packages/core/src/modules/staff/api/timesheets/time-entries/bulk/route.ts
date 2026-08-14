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
import { StaffTimeEntry, StaffTeamMember, StaffTimeProject } from '../../../../data/entities'
import { staffTimeEntryBulkSaveSchema } from '../../../../data/validators'
import {
  buildTimeEntryLockedError,
  rebaseTimeEntryIntervalToDate,
  reconcileTimeEntryInterval,
  resolveRoundedMinutes,
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

    // Validate that all referenced timeProjectIds exist and are in-scope
    const referencedProjectIds = [
      ...new Set(
        entries
          .map((e) => e.timeProjectId)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    ]
    if (referencedProjectIds.length > 0) {
      const validProjects = await em.find(StaffTimeProject, {
        id: { $in: referencedProjectIds },
        tenantId,
        organizationId,
        deletedAt: null,
      }, { fields: ['id'] })
      const validIds = new Set(validProjects.map((p) => p.id))
      const invalidIds = referencedProjectIds.filter((id) => !validIds.has(id))
      if (invalidIds.length > 0) {
        return NextResponse.json(
          {
            ok: false,
            errors: invalidIds.map((id) => ({
              path: 'entries[].timeProjectId',
              message: translate('staff.timesheets.errors.projectNotFound', 'Time project not found or not accessible.'),
              value: id,
            })),
          },
          { status: 422 },
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

    const existingIds = entries
      .map((entry) => entry.id)
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
    const idlessCells = entries
      .filter((entry) => !entry.id)
      .map((entry) => `${cellDateKey(entry.date)}|${entry.timeProjectId}`)
    const lockConditions: Record<string, unknown>[] = []
    if (existingIds.length > 0) lockConditions.push({ id: { $in: existingIds } })
    if (idlessCells.length > 0) {
      lockConditions.push({
        date: { $in: entries.filter((entry) => !entry.id).map((entry) => entry.date) },
        timeProjectId: { $in: [...new Set(entries.filter((entry) => !entry.id).map((entry) => entry.timeProjectId))] },
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
    // of the loop because it is tenant-scoped and identical for every row.
    const roundedFor = new Map<number, number>()
    for (const durationMinutes of new Set(entries.map((entry) => entry.durationMinutes))) {
      roundedFor.set(durationMinutes, await resolveRoundedMinutes(container, tenantId, durationMinutes))
    }

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

      for (const entry of entries) {
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
            existing.date = entry.date
            existing.timeProjectId = entry.timeProjectId
            existing.startedAt = interval.startedAt
            existing.endedAt = interval.endedAt
            existing.durationMinutes = interval.durationMinutes
            // D-7 keeps `rounded_minutes` the only input to cost, so it is restated
            // from the effective duration the reconciliation settled on.
            existing.roundedMinutes = roundedFor.get(interval.durationMinutes) ?? interval.durationMinutes
            existing.notes = entry.notes ?? existing.notes
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
            timeProjectId: entry.timeProjectId,
            durationMinutes: entry.durationMinutes,
            roundedMinutes: roundedFor.get(entry.durationMinutes) ?? entry.durationMinutes,
            notes: entry.notes ?? null,
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
        'Creates, updates, or soft-deletes multiple time entries in a single request. Entries with durationMinutes=0 and an existing id are soft-deleted. The whole batch is rejected with 409 time_entry_locked when any row targets — by id, or by landing on its (project, date) cell — an entry frozen in a closed report.',
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
