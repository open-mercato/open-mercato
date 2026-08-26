/**
 * US-D6 — "Kopiuj wczorajszy dzień" (screen 1, note 5).
 *
 * The note is the design constraint: the button "duplicates the previous working
 * day's entries **as versions to correct**". So this endpoint is not a silent
 * commit — it answers with the entries it created, in full, so the caller can put
 * them straight in front of the user for review and adjustment rather than
 * reporting a count and leaving them to hunt for what landed.
 *
 * What "the previous working day" means is the CALLER's business. Weekends,
 * holidays and four-day weeks are calendar questions this module has no data for,
 * and a server-side weekend rule would be wrong for every tenant that does not
 * work Monday-to-Friday. The endpoint therefore takes two explicit days.
 *
 * Three decisions worth their reasoning:
 *
 *  1. **A locked SOURCE is skipped and reported, not fatal.** The lock protects
 *     the numbers a closed report has already billed (D-7), and a copy never
 *     writes to its source — the target day is a fresh, unlocked draft. This is
 *     what makes it different from the grid bulk save, where the rows being
 *     WRITTEN are the locked ones and the whole batch must fail. Here the caller
 *     did not hand-pick rows: they asked for a day. Failing the whole day because
 *     one of its entries sits in a closed report would break the button for
 *     exactly the people who report most regularly. Every skipped source comes
 *     back in `skipped[]` carrying the shared `time_entry_locked` code and the
 *     report that froze it, so the UI can say what was left behind.
 *  2. **Idempotency: a non-empty target day is refused.** A day of entries has no
 *     natural key to deduplicate on — two identical 30-minute stand-ups on one day
 *     are legitimate data — so a second call cannot tell a re-run from a genuine
 *     repeat, and would silently double the day into something the user cannot
 *     untangle from the grid. So the default is to refuse with `409
 *     copy_day_target_not_empty`, naming what is already there. `allowDuplicates:
 *     true` is the deliberate opt-in for the real case the refusal would
 *     otherwise block: the user already logged something today and still wants
 *     yesterday's set on top. Refusing is also what makes a partially completed
 *     run visible instead of compounding it.
 *  3. **The copy itself is the existing duplicate command, once per source.** It
 *     already resolves the source, runs the lock gate and delegates the write to
 *     the create command, so every copy inherits ownership, project access, the
 *     billable and currency defaults, rounding (D-7), tags and audit unchanged.
 *     The loop is NOT wrapped in a route-level transaction: the command bus forks
 *     its own EntityManager per command, so an outer `em.transactional` would
 *     enclose nothing and the atomicity would be a fiction. Each copy is atomic in
 *     itself; a copy that fails is reported in `skipped[]` and the rest still
 *     land, which is the behaviour a day of drafts wants.
 */

import { NextResponse } from 'next/server'
import { resolveFeatureAccess } from '../../../../lib/time-tracking/featureAccess'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError, forbidden, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { emitStaffEvent } from '../../../../events'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { StaffTimeEntry, StaffTimeEntryTag } from '../../../../data/entities'
import { staffTimeEntryCommandIds, TIME_ENTRY_LOCKED_CODE } from '../../../../commands/timesheets-entries'
import { resolveProjectAccess, type ProjectAccess } from '../../../../lib/time-tracking/access'
import { readTimeTrackingSettings } from '../../../../lib/time-tracking/settings'
import { STAFF_TIME_TRACKING_RESOURCE_KINDS } from '../../../guards'
import { runTimesheetInterceptors } from '../../_shared/withTimesheetInterceptors'

const logger = createLogger('staff').child({ component: 'api/timesheets/time-entries/copy-day' })

const MANAGE_OWN_FEATURE = 'staff.timesheets.manage_own'
const MANAGE_ALL_FEATURE = 'staff.timesheets.manage_all'
const RESOURCE_KIND = STAFF_TIME_TRACKING_RESOURCE_KINDS.timeEntry

/** The 409 a second "copy yesterday" click gets, rather than a doubled day. */
export const COPY_DAY_TARGET_NOT_EMPTY_CODE = 'copy_day_target_not_empty'

/** Reason codes on `skipped[]`. The locked one is the shared code, not a second spelling of it. */
const COPY_FAILED_REASON = 'copy_failed'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: [MANAGE_OWN_FEATURE] },
}

const copyDayRequestSchema = z.object({
  fromDate: z.coerce.date(),
  toDate: z.coerce.date(),
  /** Only a `staff.timesheets.manage_all` holder may copy somebody else's day. */
  staffMemberId: z.string().uuid().optional(),
  allowDuplicates: z.boolean().optional().default(false),
})

const copiedEntrySchema = z.object({
  id: z.string().uuid(),
  sourceId: z.string().uuid(),
  date: z.string(),
  durationMinutes: z.number(),
  roundedMinutes: z.number().nullable(),
  timeProjectId: z.string().uuid().nullable(),
  taskId: z.string().uuid().nullable(),
  isBillable: z.boolean(),
  description: z.string().nullable(),
  tagIds: z.array(z.string().uuid()),
})

const skippedEntrySchema = z.object({
  id: z.string().uuid(),
  reason: z.string(),
  lockedReportId: z.string().uuid().nullable(),
  error: z.string().nullable(),
})

const copyDayResponseSchema = z.object({
  ok: z.literal(true),
  fromDate: z.string(),
  toDate: z.string(),
  staffMemberId: z.string().uuid(),
  copied: z.number(),
  created: z.array(copiedEntrySchema),
  skipped: z.array(skippedEntrySchema),
})

const targetNotEmptySchema = z.object({
  code: z.literal(COPY_DAY_TARGET_NOT_EMPTY_CODE),
  error: z.string(),
  toDate: z.string(),
  existingEntryCount: z.number(),
  existingEntryIds: z.array(z.string().uuid()),
})

type ContainerLike = { resolve: (name: string) => unknown }

type SkippedSource = {
  id: string
  reason: string
  lockedReportId: string | null
  error: string | null
}

/**
 * A day is addressed by its calendar day, never by a timestamp (D-8), so both the
 * request echo and the copied rows collapse to `YYYY-MM-DD`.
 */
function dayKey(value: Date | string | null | undefined): string {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 10)
}

async function resolveAssignmentGraceDays(container: ContainerLike, tenantId: string): Promise<number | null> {
  try {
    const configService = container.resolve('moduleConfigService') as ModuleConfigService
    const settings = await readTimeTrackingSettings(configService, { tenantId })
    return settings.access.assignmentGraceDays
  } catch {
    // Fail safe to the documented default rather than widening the window.
    return null
  }
}

async function loadProjectAccess(
  container: ContainerLike,
  userId: string | null,
  tenantId: string,
  organizationId: string,
  grantedFeatures: readonly string[],
): Promise<ProjectAccess> {
  const em = container.resolve('em') as EntityManager
  return resolveProjectAccess({
    em: em.fork(),
    userId,
    tenantId,
    organizationId,
    userFeatures: grantedFeatures,
    assignmentGraceDays: await resolveAssignmentGraceDays(container, tenantId),
  })
}

/**
 * The per-row form of the list route's `$or` intersection: an entry on a project
 * is visible to the members of that project, and a project-less entry is visible
 * only to the member who logged it. A manager copying somebody else's day still
 * only copies the part of it their own project access covers.
 */
function isTimeEntryVisible(
  entry: { staffMemberId: string; timeProjectId?: string | null },
  access: ProjectAccess,
): boolean {
  if (access.canManageAll) return true
  const projectId = entry.timeProjectId ?? null
  if (projectId) return access.projectIds.includes(projectId)
  return access.staffMemberId !== null && access.staffMemberId === entry.staffMemberId
}

async function loadTagIdsByEntry(
  em: EntityManager,
  entryIds: string[],
  tenantId: string,
  organizationId: string,
): Promise<Map<string, string[]>> {
  const byEntryId = new Map<string, string[]>()
  if (entryIds.length === 0) return byEntryId
  const assignments = await em.find(StaffTimeEntryTag, {
    timeEntryId: { $in: entryIds },
    tenantId,
    organizationId,
  })
  for (const assignment of assignments) {
    const list = byEntryId.get(assignment.timeEntryId) ?? []
    list.push(assignment.tagId)
    byEntryId.set(assignment.timeEntryId, list)
  }
  return byEntryId
}

export async function POST(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()
    if (!auth) {
      throw new CrudHttpError(401, { error: translate('staff.errors.unauthorized', 'Unauthorized') })
    }

    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const tenantId = scope?.tenantId ?? auth.tenantId ?? null
    const organizationId = scope?.selectedId ?? auth.orgId ?? null
    if (!tenantId || !organizationId) {
      throw new CrudHttpError(400, {
        error: translate('staff.errors.missingScope', 'Missing tenant or organization scope.'),
      })
    }

    const actorId = auth.sub ?? ''
    // Both decisions come from the module's single RBAC authority, which asks the
    // service and fails closed on every path. The nullable grant array they were
    // matched against could not say whether an empty answer meant "no grants" or
    // "could not ask", and `grantedFeatures ? … : false` silently answered the
    // second as the first.
    const manageOwn = await resolveFeatureAccess(container, actorId, [MANAGE_OWN_FEATURE], { tenantId, organizationId })
    if (!manageOwn.allowed) {
      throw forbidden(translate('staff.errors.forbidden', 'Forbidden'))
    }
    const grantedFeatures = manageOwn.grantedFeatures
    const hasManageAll = (
      await resolveFeatureAccess(container, actorId, [MANAGE_ALL_FEATURE], { tenantId, organizationId })
    ).allowed

    const interceptors = await runTimesheetInterceptors({
      request: req,
      method: 'POST',
      scope: { container, userId: actorId, tenantId, organizationId, userFeatures: grantedFeatures },
      body: await readJsonSafe<Record<string, unknown>>(req, {}),
    })
    if (!interceptors.ok) return interceptors.response
    const { session } = interceptors

    const parsed = copyDayRequestSchema.parse(session.body)
    const fromDay = dayKey(parsed.fromDate)
    const toDay = dayKey(parsed.toDate)
    if (fromDay === toDay) {
      // Copying a day onto itself is always a mistake, never intent, and
      // `allowDuplicates` would turn it into a silent doubling.
      throw new CrudHttpError(400, {
        error: translate(
          'staff.timesheets.errors.copyDaySameDate',
          'The source and target day must be different.',
        ),
      })
    }

    const access = await loadProjectAccess(container, actorId || null, tenantId, organizationId, grantedFeatures)
    // Ownership: the copies are attributed by the create command, which silently
    // files them under the caller unless they hold `staff.timesheets.manage_all`.
    // Refusing here rather than letting that happen keeps a projects-manager from
    // asking for a colleague's day and quietly receiving it under their own name.
    if (parsed.staffMemberId && parsed.staffMemberId !== access.staffMemberId && !hasManageAll) {
      throw forbidden(
        translate('staff.timesheets.errors.notOwner', 'You can only manage your own time entries.'),
      )
    }
    const staffMemberId = parsed.staffMemberId ?? access.staffMemberId
    if (!staffMemberId) {
      throw new CrudHttpError(403, {
        error: translate('staff.timesheets.errors.noStaffMember', 'No staff member linked to your account.'),
      })
    }

    const em = (container.resolve('em') as EntityManager).fork()
    const scopeCtx = { tenantId, organizationId }

    const sources = (
      await findWithDecryption(
        em,
        StaffTimeEntry,
        { tenantId, organizationId, staffMemberId, date: parsed.fromDate, deletedAt: null },
        {},
        scopeCtx,
      )
    ).filter((entry) => isTimeEntryVisible(entry, access))

    if (sources.length === 0) {
      return session.respond(200, {
        ok: true,
        fromDate: fromDay,
        toDate: toDay,
        staffMemberId,
        copied: 0,
        created: [],
        skipped: [],
      })
    }

    if (!parsed.allowDuplicates) {
      const existing = await em.find(
        StaffTimeEntry,
        { tenantId, organizationId, staffMemberId, date: parsed.toDate, deletedAt: null },
        { fields: ['id'] },
      )
      if (existing.length > 0) {
        throw new CrudHttpError(409, {
          code: COPY_DAY_TARGET_NOT_EMPTY_CODE,
          error: translate(
            'staff.timesheets.errors.copyDayTargetNotEmpty',
            'The target day already has time entries. Review them first, or confirm to add these copies anyway.',
          ),
          toDate: toDay,
          existingEntryCount: existing.length,
          existingEntryIds: existing.map((entry) => entry.id),
        })
      }
    }

    const guardResult = await runRouteMutationGuards({
      container,
      req,
      auth: {
        userId: actorId,
        tenantId,
        organizationId,
        userFeatures: grantedFeatures,
      },
      input: {
        resourceKind: RESOURCE_KIND,
        resourceId: staffMemberId,
        operation: 'create',
        mutationPayload: parsed,
      },
    })
    if (!guardResult.ok) return guardResult.response

    const skipped: SkippedSource[] = []
    const copyable: StaffTimeEntry[] = []
    for (const entry of sources) {
      if (entry.lockedReportId) {
        skipped.push({
          id: entry.id,
          reason: TIME_ENTRY_LOCKED_CODE,
          lockedReportId: entry.lockedReportId,
          error: null,
        })
        continue
      }
      copyable.push(entry)
    }

    // Tags are read here rather than inside the command: the command writes tags
    // only through the tag commands and never touches `staff_time_entry_tags`, so
    // — exactly as with the single-entry duplicate, where the client supplies the
    // `tags[]` it already holds — the caller of the command supplies them.
    const tagIdsByEntry = await loadTagIdsByEntry(em, copyable.map((entry) => entry.id), tenantId, organizationId)

    const ctx: CommandRuntimeContext = {
      container,
      auth,
      organizationScope: scope,
      selectedOrganizationId: scope?.selectedId ?? auth.orgId ?? null,
      organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
      request: req,
    }
    const commandBus = container.resolve('commandBus') as CommandBus

    const copiedIdBySource = new Map<string, string>()
    for (const entry of copyable) {
      try {
        const { result } = await commandBus.execute<unknown, { timeEntryId: string }>(
          staffTimeEntryCommandIds.duplicate,
          {
            input: {
              id: entry.id,
              date: parsed.toDate,
              tagIds: tagIdsByEntry.get(entry.id) ?? [],
            },
            ctx,
          },
        )
        if (result?.timeEntryId) copiedIdBySource.set(entry.id, result.timeEntryId)
      } catch (err) {
        // A source can stop being copyable between the read and the write — its
        // project soft-deleted, say. The day is a set of drafts, so one source
        // that cannot be copied is reported beside the locked ones instead of
        // discarding the copies that already landed.
        logger.warn('staff.timesheets.time-entries.copy-day source copy failed', { err, sourceId: entry.id })
        skipped.push({
          id: entry.id,
          reason: COPY_FAILED_REASON,
          lockedReportId: null,
          error: isCrudHttpError(err) ? String((err.body as { error?: unknown })?.error ?? '') || null : null,
        })
      }
    }

    await guardResult.runAfterSuccess()

    for (const [sourceId, createdId] of copiedIdBySource) {
      void emitStaffEvent('staff.timesheets.time_entry.copied', {
        id: createdId,
        sourceId,
        tenantId,
        organizationId,
        staffMemberId,
        date: toDay,
      }, { persistent: true }).catch((err) => {
        logger.error('staff.timesheets emit time_entry.copied failed', { err, sourceId })
      })
    }

    // Screen 1 note 5: these are drafts to correct, so the response carries the
    // rows themselves rather than a count the UI would have to go and re-fetch.
    const createdIds = Array.from(copiedIdBySource.values())
    const createdRows = createdIds.length
      ? await findWithDecryption(
          em.fork(),
          StaffTimeEntry,
          { id: { $in: createdIds }, tenantId, organizationId, deletedAt: null },
          {},
          scopeCtx,
        )
      : []
    const createdRowById = new Map(createdRows.map((row) => [row.id, row]))

    const created = Array.from(copiedIdBySource.entries()).flatMap(([sourceId, createdId]) => {
      const row = createdRowById.get(createdId)
      if (!row) return []
      return [
        {
          id: row.id,
          sourceId,
          date: dayKey(row.date),
          durationMinutes: row.durationMinutes,
          roundedMinutes: row.roundedMinutes ?? null,
          timeProjectId: row.timeProjectId ?? null,
          taskId: row.taskId ?? null,
          isBillable: row.isBillable,
          description: row.notes ?? null,
          tagIds: tagIdsByEntry.get(sourceId) ?? [],
        },
      ]
    })

    return session.respond(200, {
      ok: true,
      fromDate: fromDay,
      toDate: toDay,
      staffMemberId,
      copied: created.length,
      created,
      skipped,
    })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: translate('staff.errors.invalid_request', 'Invalid request'), details: err.issues },
        { status: 400 },
      )
    }
    logger.error('staff.timesheets.time-entries.copy-day failed', { err })
    return NextResponse.json(
      { error: translate('staff.errors.internal', 'Internal server error') },
      { status: 500 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'Copy a day of time entries',
  methods: {
    POST: {
      summary: 'Copy a day of time entries',
      description:
        'US-D6, screen 1 note 5. Copies every unlocked time entry the caller owns on `fromDate` onto `toDate` as editable drafts, and returns the created rows so they can be reviewed and corrected. Which day is "the previous working day" is the caller decision — this endpoint takes explicit dates and applies no weekend or holiday rule. A source entry locked into a closed report is skipped and reported in `skipped[]` with the shared `time_entry_locked` code (nothing is written to it, so the batch is not failed). The request is refused with 409 `copy_day_target_not_empty` when the target day already holds entries, so a repeated call cannot silently double a day; pass `allowDuplicates: true` to add the copies anyway. `staffMemberId` targets another member and requires `staff.timesheets.manage_all`. Every copy is written through the duplicate command and therefore through the create command, so ownership, project access, the billable and currency defaults and the tenant rounding rule apply to it exactly as they do to a hand-made entry.',
      requestBody: {
        contentType: 'application/json',
        schema: copyDayRequestSchema,
      },
      responses: [
        { status: 200, description: 'Copies created, with the skipped sources reported', schema: copyDayResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid body, missing scope, or fromDate equal to toDate' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing staff.timesheets.manage_own, no linked staff member, or another member day without staff.timesheets.manage_all' },
        {
          status: 409,
          description: 'The target day already has entries; nothing was copied',
          schema: targetNotEmptySchema,
        },
      ],
    },
  },
}
