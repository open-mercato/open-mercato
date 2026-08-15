import { z } from 'zod'
import type { CommandBus, CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { buildChanges, emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { makeCreateRedo } from '@open-mercato/shared/lib/commands/redo'
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import {
  StaffTimeEntry,
  StaffTimeEntrySegment,
  StaffTimeProject,
  StaffTimeTask,
  type StaffTimeEntrySource,
} from '../data/entities'
import { emitStaffEvent } from '../events'
import { deriveInterval, formatClock, parseClock } from '../lib/time-tracking/interval'
import { roundMinutes } from '../lib/time-tracking/rounding'
import {
  DEFAULT_TIME_TRACKING_SETTINGS,
  readTimeTrackingSettings,
  type TimeTrackingSettings,
} from '../lib/time-tracking/settings'
import { resolveProjectAccess, type ProjectAccess } from '../lib/time-tracking/access'
// Imported for the command ids AND for the registration side effect: the tag
// commands must be in the registry before this file asks the bus to run one.
import { staffTimeTagCommandIds, TAG_TARGET_LOCKED_CODE } from './timesheets-tags'

const timeEntryCrudIndexer: CrudIndexerConfig<StaffTimeEntry> = {
  entityType: 'staff:staff_time_entry',
}
import {
  staffTimeEntryCreateSchema,
  staffTimeEntryStartTimerSchema,
  staffTimeEntryUpdateSchema,
  type StaffTimeEntryCreateInput,
  type StaffTimeEntryStartTimerInput,
  type StaffTimeEntryUpdateInput,
} from '../data/validators'
import { staffTimeEntryCrudEvents } from '../lib/crud'
import {
  applyScopeToWhere,
  commandActorScope,
  commandInputScope,
  ensureOrganizationScope,
  ensureTenantScope,
  extractUndoPayload,
  scopeForDecryption,
  scopedStaffSnapshotWhere,
  staffSnapshotDecryptionScope,
  staffSnapshotScopeFromContext,
  staffSnapshotScopeFromSnapshot,
  type StaffSnapshotScope,
} from './shared'
import { getStaffMemberByUserId } from '../lib/staffMemberResolver'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('staff')

type ContainerLike = { resolve: (token: string) => unknown }

type Translate = (key: string, fallback?: string) => string

type RbacServiceLike = {
  userHasAllFeatures: (
    userId: string,
    required: string[],
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<boolean>
  getGrantedFeatures?: (
    userId: string,
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<string[]>
}

/**
 * Returns true when the caller holds `staff.timesheets.manage_all`, honoring
 * wildcard ACL grants (`staff.*`, `*`) and the super-admin flag via the cached
 * rbacService. Returns false when no auth context (e.g. system/CLI ctx) so
 * write paths that lack a caller identity are NOT silently elevated.
 */
async function callerHasManageAll(ctx: {
  auth?: { sub?: string | null; tenantId?: string | null; orgId?: string | null } | null
  container: { resolve: (token: string) => unknown }
}): Promise<boolean> {
  const userId = ctx.auth?.sub
  if (!userId) return false
  try {
    const rbac = ctx.container.resolve('rbacService') as RbacServiceLike | undefined
    if (!rbac?.userHasAllFeatures) return false
    return await rbac.userHasAllFeatures(
      userId,
      ['staff.timesheets.manage_all'],
      { tenantId: ctx.auth?.tenantId ?? null, organizationId: ctx.auth?.orgId ?? null },
    )
  } catch {
    return false
  }
}

async function resolveCallerStaffMemberId(
  em: EntityManager,
  ctx: { auth?: { sub?: string | null; tenantId?: string | null; orgId?: string | null } | null },
): Promise<string | null> {
  const userId = ctx.auth?.sub
  if (!userId) return null
  const member = await getStaffMemberByUserId(
    em,
    userId,
    ctx.auth?.tenantId ?? null,
    ctx.auth?.orgId ?? null,
  )
  return member?.id ?? null
}

/**
 * Verifies the referenced time project exists and is in-scope (same tenant + org,
 * not soft-deleted) and hands the row back — the write path reads its
 * `billableByDefault` and `currencyCode` to seed the entry. Throws 422 if the ID
 * is provided but unresolvable. Returns null when projectId is null/undefined
 * (timeProjectId is optional on entries).
 */
async function requireTimeProjectInScope(
  em: EntityManager,
  projectId: string | null | undefined,
  tenantId: string,
  organizationId: string,
): Promise<StaffTimeProject | null> {
  if (!projectId) return null
  const project = await em.findOne(StaffTimeProject, {
    id: projectId,
    tenantId,
    organizationId,
    deletedAt: null,
  })
  if (!project) {
    const { translate } = await resolveTranslations()
    throw new CrudHttpError(422, {
      error: translate('staff.timesheets.errors.projectNotFound', 'Time project not found or not accessible.'),
      fieldErrors: {
        timeProjectId: translate('staff.timesheets.errors.projectNotFound', 'Time project not found or not accessible.'),
      },
    })
  }
  return project
}

/**
 * Same contract as the project check, for `task_id`. A dangling task reference is
 * refused rather than stored: the task rollups on screens 6 and 7 aggregate entries
 * by `task_id`, so a stale or foreign UUID would silently move hours onto another
 * project's card.
 */
async function requireTaskInScope(
  em: EntityManager,
  taskId: string | null | undefined,
  tenantId: string,
  organizationId: string,
): Promise<StaffTimeTask | null> {
  if (!taskId) return null
  const task = await em.findOne(StaffTimeTask, {
    id: taskId,
    tenantId,
    organizationId,
    deletedAt: null,
  })
  if (!task) {
    const { translate } = await resolveTranslations()
    const message = translate('staff.timesheets.errors.taskNotFound', 'Task not found or not accessible.')
    throw new CrudHttpError(422, { error: message, fieldErrors: { taskId: message } })
  }
  return task
}

/**
 * A task belongs to exactly one project, so an entry naming both must name the
 * same one. Letting them disagree would file the hours under a project whose
 * board never shows the task — the same rollup corruption the task-scope check
 * above prevents, one level up.
 */
async function assertTaskBelongsToProject(
  task: StaffTimeTask | null,
  projectId: string | null,
): Promise<void> {
  if (timeEntryTaskMatchesProject(task, projectId)) return
  const { translate } = await resolveTranslations()
  const message = translate('staff.timesheets.errors.taskNotFound', 'Task not found or not accessible.')
  throw new CrudHttpError(422, { error: message, fieldErrors: { taskId: message } })
}

/**
 * The rule the assertion above enforces, as a predicate: a task belongs to
 * exactly one project, so an entry naming both must name the same one. Exported
 * because the grid bulk save validates a whole batch at once and answers with a
 * per-row error list rather than a thrown 422 — it reuses the rule and only
 * differs in how it reports a violation.
 */
export function timeEntryTaskMatchesProject(
  task: { timeProjectId?: string | null } | null | undefined,
  projectId: string | null | undefined,
): boolean {
  if (!task || !projectId) return true
  return task.timeProjectId === projectId
}

/**
 * Screen 8 picks a task and lets the project follow from it ("Projekt i klient
 * wynikają z zadania"), so a write that names only a task still lands on the
 * project the task belongs to — and with it the billable and currency defaults.
 * One derivation for every write path, including the grid bulk save.
 */
export function resolveTimeEntryProjectId(
  requestedProjectId: string | null | undefined,
  task: { timeProjectId?: string | null } | null | undefined,
): string | null {
  return requestedProjectId ?? task?.timeProjectId ?? null
}

/**
 * The billable default chain, in one place: an explicit value wins, then the
 * project's own default — a fixed-price engagement is non-billable however the
 * tenant normally works — and the tenant setting only decides what is left.
 */
export function resolveTimeEntryBillable(params: {
  requested?: boolean | null
  project?: { billableByDefault?: boolean | null } | null
  settings: TimeTrackingSettings
}): boolean {
  return params.requested ?? params.project?.billableByDefault ?? params.settings.defaults.billable
}

/**
 * Rounding and the billable default are tenant settings. A settings read that
 * fails must not fail the write, so it degrades to the documented defaults —
 * the same fail-safe the projects and tasks routes apply to the grace window.
 */
async function readEntrySettingsFrom(
  container: ContainerLike,
  tenantId: string,
): Promise<TimeTrackingSettings> {
  try {
    const configService = container.resolve('moduleConfigService') as ModuleConfigService | undefined
    if (!configService?.getRecord) return DEFAULT_TIME_TRACKING_SETTINGS
    return await readTimeTrackingSettings(configService, { tenantId })
  } catch {
    return DEFAULT_TIME_TRACKING_SETTINGS
  }
}

async function readEntrySettings(ctx: CommandRuntimeContext, tenantId: string): Promise<TimeTrackingSettings> {
  return readEntrySettingsFrom(ctx.container, tenantId)
}

/**
 * The same tenant-settings read, for write paths that run outside a command —
 * the grid bulk save reads it ONCE per request (it is identical for every row)
 * and then seeds rounding and the billable default from that one snapshot.
 */
export async function resolveTimeEntrySettings(
  container: ContainerLike,
  tenantId: string,
): Promise<TimeTrackingSettings> {
  return readEntrySettingsFrom(container, tenantId)
}

/**
 * The single rounding entry point for write paths that cannot run inside this
 * command file — the grid bulk save and timer-stop both compute a duration in
 * their own transaction, and D-7 makes `rounded_minutes` the ONLY input to cost,
 * so a duration written without its rounded twin bills nothing. They call this
 * rather than reaching for `roundMinutes` themselves, which keeps the tenant
 * settings read, its fail-safe, and the rule itself in one place.
 */
export async function resolveRoundedMinutes(
  container: ContainerLike,
  tenantId: string,
  durationMinutes: number,
): Promise<number> {
  return roundedMinutesFor(durationMinutes, await readEntrySettingsFrom(container, tenantId))
}

async function resolveGrantedFeatures(
  ctx: CommandRuntimeContext,
  tenantId: string,
  organizationId: string,
): Promise<string[]> {
  const userId = ctx.auth?.sub
  if (!userId) return []
  try {
    const rbac = ctx.container.resolve('rbacService') as RbacServiceLike | undefined
    if (!rbac?.getGrantedFeatures) return []
    return (await rbac.getGrantedFeatures(userId, { tenantId, organizationId })) ?? []
  } catch {
    // Fail closed: an unreadable grant set is no grant set, so the caller falls
    // back to their project memberships instead of being treated as a manager.
    return []
  }
}

async function resolveEntryProjectAccess(
  em: EntityManager,
  ctx: CommandRuntimeContext,
  tenantId: string,
  organizationId: string,
  settings: TimeTrackingSettings,
): Promise<ProjectAccess> {
  return resolveProjectAccess({
    em: em.fork(),
    userId: ctx.auth?.sub ?? null,
    tenantId,
    organizationId,
    userFeatures: await resolveGrantedFeatures(ctx, tenantId, organizationId),
    assignmentGraceDays: settings.access.assignmentGraceDays,
  })
}

/**
 * Every entry write intersects the caller's project access. An entry that names a
 * project is writable by a project manager or an assigned member; an entry with no
 * project belongs to nobody else, so only the member who logged it may touch it.
 * `staff.timesheets.manage_all` stays a superset of both, which is what it has
 * always meant on this route.
 */
async function assertEntryProjectAccess(params: {
  access: ProjectAccess
  hasManageAll: boolean
  projectId: string | null
  entryStaffMemberId: string
}): Promise<void> {
  if (params.hasManageAll || params.access.canManageAll) return
  const { translate } = await resolveTranslations()
  if (params.projectId) {
    if (params.access.projectIds.includes(params.projectId)) return
    throw new CrudHttpError(403, {
      error: translate('staff.timesheets.errors.notAssigned', 'You are not assigned to this project.'),
    })
  }
  if (params.access.staffMemberId && params.access.staffMemberId === params.entryStaffMemberId) return
  throw new CrudHttpError(403, {
    error: translate('staff.timesheets.errors.notOwner', 'You can only manage your own time entries.'),
  })
}

/**
 * `notes` is the column; `description` is the name every consulting-suite screen
 * uses for it. Both keys are accepted on write and `description` wins when a
 * request carries both — the precedence UPGRADE_NOTES.md already published, and
 * the one that matches intent: a client sending the new key means it.
 * Returns `undefined` when neither key was supplied, so a PUT that omits both
 * leaves the stored note alone.
 *
 * Exported so the grid bulk save applies the SAME precedence — it accepts both
 * keys too, and a second interpretation of which one wins is exactly the kind of
 * divergence that makes one screen's edit disappear on another.
 */
export function resolveTimeEntryNotesInput(parsed: {
  notes?: string | null
  description?: string | null
}): string | null | undefined {
  if (parsed.description !== undefined) return parsed.description ?? null
  if (parsed.notes !== undefined) return parsed.notes ?? null
  return undefined
}

/**
 * `rate_override_amount` is `numeric(14,4)`, which MikroORM surfaces as a string;
 * the validator accepts a JSON number. One conversion point keeps the two apart,
 * for the grid bulk save as much as for this file.
 */
export function toStoredTimeEntryRateOverride(amount: number | null | undefined): string | null {
  return amount === null || amount === undefined ? null : String(amount)
}

/**
 * D-7: `duration_minutes` keeps the RAW value the user entered — it is what the
 * timesheet and the project hour totals display — while `rounded_minutes` is
 * derived from the tenant's rounding rule at write time and is the only input to
 * cost. Storing the rounded value rather than deriving it on read is what stops a
 * later settings change from silently restating money that has already been
 * invoiced (risk R1).
 */
export function roundedMinutesFor(durationMinutes: number, settings: TimeTrackingSettings): number {
  return roundMinutes(durationMinutes, settings.rounding)
}

export type TimeEntryInterval = {
  startedAt: Date | null
  endedAt: Date | null
  durationMinutes: number
}

/**
 * `started_at` / `ended_at` are absolute timestamps; `deriveInterval` reasons in
 * wall-clock minutes. Both directions read and write the SAME basis (UTC), so a
 * timestamp that needs no correction survives the round trip untouched.
 */
function clockOfTimestamp(value: Date): string {
  return formatClock(value.getUTCHours() * 60 + value.getUTCMinutes())
}

function timestampOnDayOf(reference: Date, clock: string, dayOffset: number): Date {
  const minutesOfDay = parseClock(clock) ?? 0
  return new Date(
    Date.UTC(
      reference.getUTCFullYear(),
      reference.getUTCMonth(),
      reference.getUTCDate() + dayOffset,
      Math.floor(minutesOfDay / 60),
      minutesOfDay % 60,
      0,
      0,
    ),
  )
}

/**
 * D-8. An end whose clock is earlier than its start's is a midnight crossing, not
 * a validation error, so the end belongs on the NEXT calendar day while `date`
 * keeps naming the day the work started. A caller that already sent the end on
 * the following day (the entry dialog does) is left exactly as it sent it.
 */
function alignEndToStart(startedAt: Date, endedAt: Date, endClock: string, crossesMidnight: boolean): Date {
  if (endedAt.getTime() >= startedAt.getTime()) return endedAt
  return timestampOnDayOf(startedAt, endClock, crossesMidnight ? 1 : 0)
}

/**
 * US-D3, on the update path: `duration_minutes`, `started_at` and `ended_at` can
 * each be written on their own, and the server must never store a set that
 * contradicts itself — a two-hour duration on a 09:00–10:00 span is a
 * defensible-invoice problem, not a cosmetic one (D-7 bills the rounded twin of
 * whatever duration lands here).
 *
 * The rule, in one line: **the clocks are the observation and the duration is
 * their summary, so the clocks win — unless the duration is the field the request
 * actually pinned, in which case the untouched clock moves to match it.**
 *
 *  - both clocks in the request → the duration is recomputed from them, and a
 *    duration sent alongside is advisory (this is what the entry dialog sends);
 *  - one clock plus a duration → the OTHER clock is derived from that pair;
 *  - one clock alone → the duration is recomputed against the stored counterpart;
 *  - the duration alone → `started_at` anchors and `ended_at` shifts to match;
 *  - none of the three → every one of them is left exactly as stored.
 *
 * Derivation only ever RESTATES a clock that already exists: with one side null
 * there is nothing for a duration to contradict, and manufacturing the missing
 * side would silently stop a running timer.
 *
 * Exported because the grid bulk save writes durations in its own transaction
 * (per-row, pessimistically locked) and cannot go through this command — it calls
 * the same reconciliation rather than repeating the arithmetic, which is what
 * keeps one rule for one invariant.
 */
export function reconcileTimeEntryInterval(params: {
  stored: TimeEntryInterval
  startedAt: Date | null | undefined
  endedAt: Date | null | undefined
  durationMinutes: number | undefined
}): TimeEntryInterval {
  const startProvided = params.startedAt !== undefined
  const endProvided = params.endedAt !== undefined
  const durationProvided = params.durationMinutes !== undefined
  if (!startProvided && !endProvided && !durationProvided) return params.stored

  const startedAt = startProvided ? params.startedAt ?? null : params.stored.startedAt
  const endedAt = endProvided ? params.endedAt ?? null : params.stored.endedAt
  const durationMinutes = durationProvided
    ? (params.durationMinutes as number)
    : params.stored.durationMinutes
  if (!startedAt || !endedAt) return { startedAt, endedAt, durationMinutes }

  const startClock = clockOfTimestamp(startedAt)
  const endClock = clockOfTimestamp(endedAt)
  const durationAnchored = durationProvided && !(startProvided && endProvided)

  if (durationAnchored && !endProvided) {
    const derived = deriveInterval({ start: startClock, durationMinutes })
    return {
      startedAt,
      endedAt: timestampOnDayOf(startedAt, derived.end ?? endClock, derived.crossesMidnight ? 1 : 0),
      durationMinutes,
    }
  }

  if (durationAnchored && !startProvided) {
    const derived = deriveInterval({ end: endClock, durationMinutes })
    return {
      startedAt: timestampOnDayOf(endedAt, derived.start ?? startClock, derived.crossesMidnight ? -1 : 0),
      endedAt,
      durationMinutes,
    }
  }

  const derived = deriveInterval({ start: startClock, end: endClock, durationMinutes })
  return {
    startedAt,
    endedAt: alignEndToStart(startedAt, endedAt, endClock, derived.crossesMidnight),
    durationMinutes: derived.durationMinutes ?? durationMinutes,
  }
}

const MS_PER_DAY = 86_400_000

function toDateOrNull(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function utcDayIndex(value: Date): number {
  return Math.round(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()) / MS_PER_DAY,
  )
}

/**
 * T4.10(b): moving an entry to another day moves the work with it.
 *
 * `date` names the day the work STARTED (D-8), so an entry re-dated to Tuesday
 * whose clocks stayed on Monday is the same self-contradicting triple T4.9
 * eliminated one field over — a 09:00–10:00 span filed against a day it did not
 * happen on, and a defensible-invoice problem the moment anyone reads the times
 * back. "Move this entry to Tuesday" means the whole observation moves.
 *
 * The clocks are SHIFTED by whole days rather than recomposed from the new date,
 * which preserves two things a recomposition would destroy: the stored offset
 * between `date` and the timestamps (for a tenant east of UTC a 01:00 local start
 * legitimately sits on the previous UTC day), and a midnight crossing (an end
 * already on the following day stays on the following day).
 *
 * Two things it never does, both inherited from the reconciliation rule above:
 *
 *  - a clock that does not exist is not manufactured, and
 *  - a RUNNING timer — a start with no end — is left exactly where it is, because
 *    re-anchoring its start would restate the elapsed time of work still in
 *    progress, and nothing about re-dating the row says the timer began later.
 */
export function rebaseTimeEntryIntervalToDate(params: {
  stored: TimeEntryInterval
  fromDate: Date | string | null | undefined
  toDate: Date | string | null | undefined
}): TimeEntryInterval {
  const fromDate = toDateOrNull(params.fromDate)
  const toDate = toDateOrNull(params.toDate)
  if (!fromDate || !toDate) return params.stored

  const { startedAt, endedAt } = params.stored
  if (!startedAt && !endedAt) return params.stored
  if (startedAt && !endedAt) return params.stored

  const shiftMs = (utcDayIndex(toDate) - utcDayIndex(fromDate)) * MS_PER_DAY
  if (shiftMs === 0) return params.stored
  return {
    startedAt: startedAt ? new Date(startedAt.getTime() + shiftMs) : null,
    endedAt: endedAt ? new Date(endedAt.getTime() + shiftMs) : null,
    durationMinutes: params.stored.durationMinutes,
  }
}

/**
 * Reuses the code the tag commands already refuse a frozen entry with, rather
 * than inventing a second one — a client that learned to handle `time_entry_locked`
 * from `…/tags/entry-assignments` handles it identically everywhere else.
 */
export const TIME_ENTRY_LOCKED_CODE = TAG_TARGET_LOCKED_CODE

export type LockedTimeEntryRef = { id: string; lockedReportId?: string | null }

/**
 * The 409 body names the report that froze the entries so screen 10 note 4 can
 * link straight to it, and lists the offending ids so a grid save can mark those
 * cells read-only instead of showing an opaque failure. `lockedReportId` is kept
 * beside the arrays for shape-compatibility with the tag commands' single-target
 * refusal.
 */
export function buildTimeEntryLockedError(
  lockedEntries: LockedTimeEntryRef[],
  translate: Translate,
): CrudHttpError {
  const lockedEntryIds = lockedEntries.map((entry) => entry.id)
  const lockedReportIds = Array.from(
    new Set(
      lockedEntries
        .map((entry) => entry.lockedReportId)
        .filter((reportId): reportId is string => typeof reportId === 'string' && reportId.length > 0),
    ),
  )
  return new CrudHttpError(409, {
    code: TIME_ENTRY_LOCKED_CODE,
    error:
      lockedEntryIds.length > 1
        ? translate(
            'staff.time_tracking.entries.errors.entriesLocked',
            'Some of these time entries are locked in a closed report and cannot be changed. Unlock the report first.',
          )
        : translate(
            'staff.time_tracking.entries.errors.entryLocked',
            'This time entry is locked in a closed report and cannot be changed. Unlock the report first.',
          ),
    lockedReportId: lockedReportIds[0] ?? null,
    lockedEntryIds,
    lockedReportIds,
  })
}

/**
 * The lock gate (risk R3). It sits in the command layer rather than in each write
 * route because the routes are the part that keeps growing: duplicate, copy-day
 * and the grid bulk save all arrived after the lock did, and any one of them
 * could have forgotten a per-route check. Every command that resolves an entry
 * for mutation runs this immediately after the row is loaded, so a field added to
 * the update command later is frozen without anybody remembering to freeze it.
 *
 * No permission lifts it — not `staff.timesheets.manage_all`. An entry frozen in
 * a closed report has already been billed at those minutes (D-7), so the only way
 * back is the Phase-6 unlock command, which clears `locked_report_id` itself and
 * therefore never reaches this gate.
 */
export function assertTimeEntryUnlocked(
  entry: { id: string; lockedReportId?: string | null },
  translate: Translate,
): void {
  if (!entry.lockedReportId) return
  throw buildTimeEntryLockedError([{ id: entry.id, lockedReportId: entry.lockedReportId }], translate)
}

/**
 * Tags are written through the tag commands, never through the junction table, so
 * an entry write inherits their guarantees unchanged: unknown ids are refused,
 * re-sending a tag is idempotent, an entry frozen in a closed report is refused
 * with 409 `time_entry_locked`, and each change lands in the audit log with its
 * own undo.
 *
 * `tagIds` is a SET, not an append. The assign command answers with the target's
 * full tag list, and that answer is what tells us which tags must then be
 * unassigned — so the desired state is reached without this file ever reading or
 * writing `staff_time_entry_tags` itself.
 */
async function syncEntryTags(
  ctx: CommandRuntimeContext,
  params: { timeEntryId: string; tenantId: string; organizationId: string; tagIds: string[] },
): Promise<void> {
  const bus = ctx.container.resolve('commandBus') as CommandBus
  const desired = Array.from(new Set(params.tagIds))
  const scoped = {
    tenantId: params.tenantId,
    organizationId: params.organizationId,
    timeEntryId: params.timeEntryId,
  }

  const assigned = await bus.execute<unknown, { tagIds?: string[] }>(staffTimeTagCommandIds.assignEntry, {
    input: { ...scoped, tagIds: desired },
    ctx,
  })

  const current = assigned?.result?.tagIds ?? desired
  const stale = current.filter((tagId) => !desired.includes(tagId))
  if (stale.length === 0) return

  await bus.execute(staffTimeTagCommandIds.unassignEntry, {
    input: { ...scoped, tagIds: stale },
    ctx,
  })
}

type TimeEntrySnapshot = {
  id: string
  tenantId: string
  organizationId: string
  staffMemberId: string
  date: string
  durationMinutes: number
  roundedMinutes: number | null
  startedAt: string | null
  endedAt: string | null
  notes: string | null
  timeProjectId: string | null
  taskId: string | null
  customerId: string | null
  dealId: string | null
  orderId: string | null
  isBillable: boolean
  rateOverrideAmount: string | null
  rateCurrencyCode: string | null
  source: string
  deletedAt: string | null
}

type TimeEntryUndoPayload = {
  before?: TimeEntrySnapshot | null
  after?: TimeEntrySnapshot | null
}

async function loadTimeEntrySnapshot(em: EntityManager, id: string, scope?: StaffSnapshotScope | null): Promise<TimeEntrySnapshot | null> {
  const entry = await findOneWithDecryption(
    em,
    StaffTimeEntry,
    scopedStaffSnapshotWhere(id, scope),
    undefined,
    staffSnapshotDecryptionScope(scope),
  )
  if (!entry) return null
  return {
    id: entry.id,
    tenantId: entry.tenantId,
    organizationId: entry.organizationId,
    staffMemberId: entry.staffMemberId,
    date: entry.date instanceof Date ? entry.date.toISOString().split('T')[0] : String(entry.date),
    durationMinutes: entry.durationMinutes,
    roundedMinutes: entry.roundedMinutes ?? null,
    startedAt: entry.startedAt ? entry.startedAt.toISOString() : null,
    endedAt: entry.endedAt ? entry.endedAt.toISOString() : null,
    notes: entry.notes ?? null,
    timeProjectId: entry.timeProjectId ?? null,
    taskId: entry.taskId ?? null,
    customerId: entry.customerId ?? null,
    dealId: entry.dealId ?? null,
    orderId: entry.orderId ?? null,
    isBillable: entry.isBillable,
    rateOverrideAmount: entry.rateOverrideAmount ?? null,
    rateCurrencyCode: entry.rateCurrencyCode ?? null,
    source: entry.source,
    deletedAt: entry.deletedAt ? entry.deletedAt.toISOString() : null,
  }
}

function timeEntrySeedFromSnapshot(snapshot: TimeEntrySnapshot): Record<string, unknown> {
  return {
    id: snapshot.id,
    tenantId: snapshot.tenantId,
    organizationId: snapshot.organizationId,
    staffMemberId: snapshot.staffMemberId,
    date: snapshot.date,
    durationMinutes: snapshot.durationMinutes,
    roundedMinutes: snapshot.roundedMinutes ?? null,
    startedAt: snapshot.startedAt ? new Date(snapshot.startedAt) : null,
    endedAt: snapshot.endedAt ? new Date(snapshot.endedAt) : null,
    notes: snapshot.notes ?? null,
    timeProjectId: snapshot.timeProjectId ?? null,
    taskId: snapshot.taskId ?? null,
    customerId: snapshot.customerId ?? null,
    dealId: snapshot.dealId ?? null,
    orderId: snapshot.orderId ?? null,
    isBillable: snapshot.isBillable ?? true,
    rateOverrideAmount: snapshot.rateOverrideAmount ?? null,
    rateCurrencyCode: snapshot.rateCurrencyCode ?? null,
    source: (snapshot.source ?? 'manual') as StaffTimeEntrySource,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  }
}

const createTimeEntryCommand: CommandHandler<StaffTimeEntryCreateInput, { timeEntryId: string }> = {
  id: 'staff.timesheets.time_entries.create',
  async execute(rawInput, ctx) {
    const parsed = staffTimeEntryCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    commandInputScope(ctx, parsed.tenantId, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()

    // Ownership enforcement: callers without `staff.timesheets.manage_all`
    // can only create entries attributed to themselves. Silent override
    // (mirrors `bulk/route.ts` behavior) so the request body's staffMemberId
    // can't forge an entry under a colleague's identity.
    let effectiveStaffMemberId = parsed.staffMemberId
    if (!(await callerHasManageAll(ctx))) {
      const callerStaffMemberId = await resolveCallerStaffMemberId(em, ctx)
      if (!callerStaffMemberId) {
        const { translate } = await resolveTranslations()
        throw new CrudHttpError(403, {
          error: translate('staff.timesheets.errors.noStaffMember', 'No staff member linked to your account.'),
        })
      }
      effectiveStaffMemberId = callerStaffMemberId
    }

    // Validate referenced task and timeProjectId are in-scope before persisting.
    // Without these checks a foreign or stale UUID would produce a dangling reference.
    const task = await requireTaskInScope(em, parsed.taskId ?? null, parsed.tenantId, parsed.organizationId)
    const requestedProjectId = resolveTimeEntryProjectId(parsed.timeProjectId, task)
    const project = await requireTimeProjectInScope(em, requestedProjectId, parsed.tenantId, parsed.organizationId)
    await assertTaskBelongsToProject(task, project?.id ?? null)

    const settings = await readEntrySettings(ctx, parsed.tenantId)
    await assertEntryProjectAccess({
      access: await resolveEntryProjectAccess(em, ctx, parsed.tenantId, parsed.organizationId, settings),
      hasManageAll: await callerHasManageAll(ctx),
      projectId: project?.id ?? null,
      entryStaffMemberId: effectiveStaffMemberId,
    })

    const now = new Date()
    const entry = em.create(StaffTimeEntry, {
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      staffMemberId: effectiveStaffMemberId,
      date: parsed.date,
      durationMinutes: parsed.durationMinutes,
      roundedMinutes: roundedMinutesFor(parsed.durationMinutes, settings),
      startedAt: parsed.startedAt ?? null,
      endedAt: parsed.endedAt ?? null,
      notes: resolveTimeEntryNotesInput(parsed) ?? null,
      timeProjectId: project?.id ?? null,
      taskId: task?.id ?? null,
      customerId: parsed.customerId ?? null,
      dealId: parsed.dealId ?? null,
      orderId: parsed.orderId ?? null,
      isBillable: resolveTimeEntryBillable({ requested: parsed.isBillable, project, settings }),
      rateOverrideAmount: toStoredTimeEntryRateOverride(parsed.rateOverrideAmount),
      // Snapshotted rather than joined at read time so a later project currency
      // change cannot re-denominate money that has already been reported (D-3).
      rateCurrencyCode: project?.currencyCode ?? null,
      source: parsed.source ?? 'manual',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
    em.persist(entry)
    await em.flush()

    if (parsed.tagIds !== undefined) {
      await syncEntryTags(ctx, {
        timeEntryId: entry.id,
        tenantId: parsed.tenantId,
        organizationId: parsed.organizationId,
        tagIds: parsed.tagIds,
      })
    }

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'created',
      entity: entry,
      identifiers: { id: entry.id, organizationId: entry.organizationId, tenantId: entry.tenantId },
      events: staffTimeEntryCrudEvents,
      indexer: timeEntryCrudIndexer,
    })

    return { timeEntryId: entry.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadTimeEntrySnapshot(em, result.timeEntryId, staffSnapshotScopeFromContext(ctx))
    if (!snapshot) return null
    return { snapshot }
  },
  buildLog: async ({ result, ctx }) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadTimeEntrySnapshot(em, result.timeEntryId, staffSnapshotScopeFromContext(ctx))
    if (!snapshot) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.timesheets.time_entries.create', 'Create time entry'),
      resourceKind: 'staff.timesheets.time_entry',
      resourceId: snapshot.id,
      tenantId: snapshot.tenantId,
      organizationId: snapshot.organizationId,
      snapshotAfter: snapshot,
      payload: {
        undo: {
          after: snapshot,
        } satisfies TimeEntryUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TimeEntryUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const entry = await em.findOne(StaffTimeEntry, scopedStaffSnapshotWhere(after.id, staffSnapshotScopeFromSnapshot(after)))
    if (entry) {
      entry.deletedAt = new Date()
      await em.flush()

      await emitCrudUndoSideEffects({
        dataEngine: ctx.container.resolve('dataEngine'),
        action: 'deleted',
        entity: entry,
        identifiers: { id: entry.id, organizationId: entry.organizationId, tenantId: entry.tenantId },
        events: staffTimeEntryCrudEvents,
      })
    }
  },
  redo: makeCreateRedo<StaffTimeEntry, TimeEntrySnapshot, StaffTimeEntryCreateInput, { timeEntryId: string }>({
    entityClass: StaffTimeEntry,
    getSnapshotId: (snapshot) => snapshot.id,
    seedFromSnapshot: timeEntrySeedFromSnapshot,
    buildResult: (entity) => ({ timeEntryId: entity.id }),
    events: staffTimeEntryCrudEvents,
    indexer: timeEntryCrudIndexer,
  }),
}

const startTimerCommand: CommandHandler<StaffTimeEntryStartTimerInput, { timeEntryId: string }> = {
  id: 'staff.timesheets.time_entries.start_timer',
  async execute(rawInput, ctx) {
    const parsed = staffTimeEntryStartTimerSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    commandInputScope(ctx, parsed.tenantId, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()

    // Ownership enforcement mirrors createTimeEntryCommand: callers without
    // `staff.timesheets.manage_all` can only start their own timer, so the
    // request body's staffMemberId can't start a timer under a colleague's id.
    let effectiveStaffMemberId = parsed.staffMemberId
    if (!(await callerHasManageAll(ctx))) {
      const callerStaffMemberId = await resolveCallerStaffMemberId(em, ctx)
      if (!callerStaffMemberId) {
        const { translate } = await resolveTranslations()
        throw new CrudHttpError(403, {
          error: translate('staff.timesheets.errors.noStaffMember', 'No staff member linked to your account.'),
        })
      }
      effectiveStaffMemberId = callerStaffMemberId
    }

    // Starting a timer on a task is ONE write. The task is validated here, in the
    // same command, so the entry is created already carrying it — the alternative
    // (start, then link) can fail after the timer is running and strand it against
    // the project instead of the task.
    const task = await requireTaskInScope(em, parsed.taskId ?? null, parsed.tenantId, parsed.organizationId)
    // A card knows its task, not always its project, and a task belongs to exactly
    // one project — so the project follows from the task, exactly as it does when
    // an entry is created from screen 8.
    const requestedProjectId = resolveTimeEntryProjectId(parsed.timeProjectId, task)
    const project = await requireTimeProjectInScope(em, requestedProjectId, parsed.tenantId, parsed.organizationId)
    await assertTaskBelongsToProject(task, project?.id ?? null)

    // A timer entry starts at zero minutes, and D-7 makes `rounded_minutes` the
    // only input to cost — leaving it null here would price the entry at nothing
    // until something else happened to rewrite it. Seeded from the same rule as
    // every other create so timer-stop only ever restates it.
    const settings = await readEntrySettings(ctx, parsed.tenantId)

    const scopeCtx = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }

    // Create the timer entry AND start it inside a single transaction so a
    // partial failure can never leave an orphaned, never-started timer entry
    // (issue #3311 — the legacy two-request create-then-start flow). The
    // single-active-timer invariant (#2855) is re-checked here so a second
    // surface cannot create a parallel running timer for the same staff member.
    const { entry, startedAt } = await em.transactional(async (trx) => {
      const otherRunningEntry = await findOneWithDecryption(
        trx,
        StaffTimeEntry,
        {
          tenantId: parsed.tenantId,
          organizationId: parsed.organizationId,
          staffMemberId: effectiveStaffMemberId,
          startedAt: { $ne: null },
          endedAt: null,
          deletedAt: null,
        },
        {},
        scopeCtx,
      )
      if (otherRunningEntry) {
        const { translate } = await resolveTranslations()
        throw new CrudHttpError(409, {
          error: translate(
            'staff.timesheets.errors.timerAlreadyRunning',
            'Another timer is already running. Stop it before starting a new one.',
          ),
        })
      }

      const startedAt = new Date()
      const entry = trx.create(StaffTimeEntry, {
        tenantId: parsed.tenantId,
        organizationId: parsed.organizationId,
        staffMemberId: effectiveStaffMemberId,
        date: parsed.date,
        durationMinutes: 0,
        roundedMinutes: roundedMinutesFor(0, settings),
        startedAt,
        endedAt: null,
        notes: parsed.notes ?? null,
        timeProjectId: project?.id ?? null,
        taskId: task?.id ?? null,
        customerId: null,
        dealId: null,
        orderId: null,
        source: 'timer',
        createdAt: startedAt,
        updatedAt: startedAt,
        deletedAt: null,
      })
      // Flush so the DB-generated id is populated before the work segment
      // references it; both writes commit together when the transaction closes.
      await trx.flush()

      const segmentData = {
        tenantId: parsed.tenantId,
        organizationId: parsed.organizationId,
        timeEntryId: entry.id,
        startedAt,
        segmentType: 'work' as const,
      }
      trx.create(StaffTimeEntrySegment, segmentData as never)
      await trx.flush()

      return { entry, startedAt }
    })

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'created',
      entity: entry,
      identifiers: { id: entry.id, organizationId: entry.organizationId, tenantId: entry.tenantId },
      events: staffTimeEntryCrudEvents,
      indexer: timeEntryCrudIndexer,
    })

    void emitStaffEvent('staff.timesheets.time_entry.timer_started', {
      id: entry.id,
      staffMemberId: effectiveStaffMemberId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      startedAt: startedAt.toISOString(),
    }, { persistent: true }).catch((err) => {
      logger.error('staff.timesheets emit timer_started failed', { err })
    })

    return { timeEntryId: entry.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadTimeEntrySnapshot(em, result.timeEntryId, staffSnapshotScopeFromContext(ctx))
    if (!snapshot) return null
    return { snapshot }
  },
  buildLog: async ({ result, ctx }) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadTimeEntrySnapshot(em, result.timeEntryId, staffSnapshotScopeFromContext(ctx))
    if (!snapshot) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.timesheets.time_entries.startTimer', 'Start timer'),
      resourceKind: 'staff.timesheets.time_entry',
      resourceId: snapshot.id,
      tenantId: snapshot.tenantId,
      organizationId: snapshot.organizationId,
      snapshotAfter: snapshot,
      payload: {
        undo: {
          after: snapshot,
        } satisfies TimeEntryUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TimeEntryUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const entry = await em.findOne(StaffTimeEntry, scopedStaffSnapshotWhere(after.id, staffSnapshotScopeFromSnapshot(after)))
    if (entry) {
      entry.deletedAt = new Date()
      await em.flush()

      await emitCrudUndoSideEffects({
        dataEngine: ctx.container.resolve('dataEngine'),
        action: 'deleted',
        entity: entry,
        identifiers: { id: entry.id, organizationId: entry.organizationId, tenantId: entry.tenantId },
        events: staffTimeEntryCrudEvents,
      })
    }
  },
}

const updateTimeEntryCommand: CommandHandler<StaffTimeEntryUpdateInput, { timeEntryId: string }> = {
  id: 'staff.timesheets.time_entries.update',
  async prepare(rawInput, ctx) {
    const parsed = staffTimeEntryUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadTimeEntrySnapshot(em, parsed.id, staffSnapshotScopeFromContext(ctx))
    if (!snapshot) return {}
    return { before: snapshot }
  },
  async execute(rawInput, ctx) {
    const parsed = staffTimeEntryUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = commandActorScope(ctx)
    const entry = await findOneWithDecryption(
      em,
      StaffTimeEntry,
      applyScopeToWhere<StaffTimeEntry>({ id: parsed.id, deletedAt: null }, scope),
      undefined,
      scopeForDecryption(scope),
    )
    if (!entry) throw new CrudHttpError(404, { error: 'Time entry not found.' })
    ensureTenantScope(ctx, entry.tenantId)
    ensureOrganizationScope(ctx, entry.organizationId)

    // Before ownership, before access, before a single field is read off the
    // request: a frozen entry is frozen for everyone, so nothing below can be
    // reached with a lock in place.
    assertTimeEntryUnlocked(entry, (await resolveTranslations()).translate)

    // Ownership enforcement: callers without `staff.timesheets.manage_all`
    // can only update entries they own.
    const hasManageAll = await callerHasManageAll(ctx)
    if (!hasManageAll) {
      const callerStaffMemberId = await resolveCallerStaffMemberId(em, ctx)
      if (!callerStaffMemberId || entry.staffMemberId !== callerStaffMemberId) {
        const { translate } = await resolveTranslations()
        throw new CrudHttpError(403, {
          error: translate('staff.timesheets.errors.notOwner', 'You can only manage your own time entries.'),
        })
      }
    }

    const task =
      parsed.taskId !== undefined
        ? await requireTaskInScope(em, parsed.taskId, entry.tenantId, entry.organizationId)
        : null

    // A task carries its project (screen 8), so re-pointing an entry at a task
    // moves the entry with it unless the request names a project explicitly.
    const nextProjectId =
      parsed.timeProjectId !== undefined
        ? parsed.timeProjectId ?? null
        : task?.timeProjectId ?? entry.timeProjectId ?? null
    const projectChanged = nextProjectId !== (entry.timeProjectId ?? null)
    const project = projectChanged
      ? await requireTimeProjectInScope(em, nextProjectId, entry.tenantId, entry.organizationId)
      : null
    await assertTaskBelongsToProject(task, nextProjectId)

    const settings = await readEntrySettings(ctx, entry.tenantId)
    const access = await resolveEntryProjectAccess(em, ctx, entry.tenantId, entry.organizationId, settings)
    // Both ends of a move are checked: a caller may not lift an entry out of a
    // project they cannot see, nor drop one into a project they cannot see.
    await assertEntryProjectAccess({
      access,
      hasManageAll,
      projectId: entry.timeProjectId ?? null,
      entryStaffMemberId: entry.staffMemberId,
    })
    if (projectChanged) {
      await assertEntryProjectAccess({
        access,
        hasManageAll,
        projectId: nextProjectId,
        entryStaffMemberId: entry.staffMemberId,
      })
    }

    const notes = resolveTimeEntryNotesInput(parsed)

    // A `date` move re-anchors the STORED clocks first, so what reconciliation
    // reasons about is the entry as it will exist on its new day. Order matters:
    // clocks the request sends explicitly still win over the rebased ones (the
    // entry dialog rebuilds all three from the new date and would otherwise be
    // shifted twice), while clocks it omits travel with the entry instead of
    // being stranded on the old day.
    const stored = rebaseTimeEntryIntervalToDate({
      stored: {
        startedAt: entry.startedAt ?? null,
        endedAt: entry.endedAt ?? null,
        durationMinutes: entry.durationMinutes,
      },
      fromDate: entry.date,
      toDate: parsed.date,
    })

    // The three time fields are settled together, before anything is assigned, so
    // no combination of them can be stored contradicting itself (US-D3, D-8).
    const interval = reconcileTimeEntryInterval({
      stored,
      startedAt: parsed.startedAt,
      endedAt: parsed.endedAt,
      durationMinutes: parsed.durationMinutes,
    })

    if (parsed.date !== undefined) entry.date = parsed.date
    if (interval.startedAt !== (entry.startedAt ?? null)) entry.startedAt = interval.startedAt
    if (interval.endedAt !== (entry.endedAt ?? null)) entry.endedAt = interval.endedAt
    if (parsed.durationMinutes !== undefined || interval.durationMinutes !== entry.durationMinutes) {
      entry.durationMinutes = interval.durationMinutes
      // Raw minutes moved — because the duration was written, or because the
      // clocks were edited and restated it — so the frozen rounded value is
      // recomputed from the tenant's current rule. D-7 makes it the only input to
      // cost, so a clock edit that changes the length of the work and leaves the
      // rounded twin behind would mis-bill it.
      entry.roundedMinutes = roundedMinutesFor(interval.durationMinutes, settings)
    }
    if (projectChanged) {
      entry.timeProjectId = nextProjectId
      entry.rateCurrencyCode = project?.currencyCode ?? null
    }
    if (parsed.taskId !== undefined) entry.taskId = task?.id ?? null
    if (parsed.customerId !== undefined) entry.customerId = parsed.customerId ?? null
    if (parsed.dealId !== undefined) entry.dealId = parsed.dealId ?? null
    if (parsed.orderId !== undefined) entry.orderId = parsed.orderId ?? null
    if (parsed.isBillable !== undefined) entry.isBillable = parsed.isBillable
    if (parsed.rateOverrideAmount !== undefined) {
      entry.rateOverrideAmount = toStoredTimeEntryRateOverride(parsed.rateOverrideAmount)
    }
    if (notes !== undefined) entry.notes = notes
    entry.updatedAt = new Date()
    await em.flush()

    if (parsed.tagIds !== undefined) {
      await syncEntryTags(ctx, {
        timeEntryId: entry.id,
        tenantId: entry.tenantId,
        organizationId: entry.organizationId,
        tagIds: parsed.tagIds,
      })
    }

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'updated',
      entity: entry,
      identifiers: { id: entry.id, organizationId: entry.organizationId, tenantId: entry.tenantId },
      events: staffTimeEntryCrudEvents,
      indexer: timeEntryCrudIndexer,
    })

    return { timeEntryId: entry.id }
  },
  buildLog: async ({ snapshots, ctx }) => {
    const before = snapshots.before as TimeEntrySnapshot | undefined
    if (!before) return null
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const after = await loadTimeEntrySnapshot(em, before.id, staffSnapshotScopeFromSnapshot(before))
    if (!after) return null
    const changes = buildChanges(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, [
      'date',
      'durationMinutes',
      'roundedMinutes',
      // A time correction is exactly the edit somebody will later have to justify
      // on an invoice, so the clocks are named in the trail beside the minutes.
      'startedAt',
      'endedAt',
      'timeProjectId',
      'taskId',
      'customerId',
      'dealId',
      'orderId',
      'isBillable',
      'rateOverrideAmount',
      'rateCurrencyCode',
      'notes',
      'deletedAt',
    ])
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.timesheets.time_entries.update', 'Update time entry'),
      resourceKind: 'staff.timesheets.time_entry',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      changes,
      payload: {
        undo: {
          before,
          after,
        } satisfies TimeEntryUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TimeEntryUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const entry = await em.findOne(StaffTimeEntry, scopedStaffSnapshotWhere(before.id, staffSnapshotScopeFromSnapshot(before)))
    if (!entry) return
    entry.date = before.date as unknown as Date
    entry.durationMinutes = before.durationMinutes
    entry.roundedMinutes = before.roundedMinutes ?? null
    // Restored beside the minutes they belong to: now that an update can move the
    // clocks, an undo that left them where the edit put them would hand back an
    // entry whose duration and span disagree.
    entry.startedAt = before.startedAt ? new Date(before.startedAt) : null
    entry.endedAt = before.endedAt ? new Date(before.endedAt) : null
    entry.timeProjectId = before.timeProjectId ?? null
    entry.taskId = before.taskId ?? null
    entry.customerId = before.customerId ?? null
    entry.dealId = before.dealId ?? null
    entry.orderId = before.orderId ?? null
    entry.isBillable = before.isBillable ?? true
    entry.rateOverrideAmount = before.rateOverrideAmount ?? null
    entry.rateCurrencyCode = before.rateCurrencyCode ?? null
    entry.notes = before.notes ?? null
    entry.deletedAt = before.deletedAt ? new Date(before.deletedAt) : null
    entry.updatedAt = new Date()
    await em.flush()

    await emitCrudUndoSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'updated',
      entity: entry,
      identifiers: { id: entry.id, organizationId: entry.organizationId, tenantId: entry.tenantId },
      events: staffTimeEntryCrudEvents,
      indexer: timeEntryCrudIndexer,
    })
  },
}

const deleteTimeEntryCommand: CommandHandler<{ id?: string }, { timeEntryId: string }> = {
  id: 'staff.timesheets.time_entries.delete',
  async prepare(input, ctx) {
    const id = input?.id
    if (!id) throw new CrudHttpError(400, { error: 'Time entry id is required.' })
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadTimeEntrySnapshot(em, id, staffSnapshotScopeFromContext(ctx))
    if (!snapshot) return {}
    return { before: snapshot }
  },
  async execute(input, ctx) {
    const id = input?.id
    if (!id) throw new CrudHttpError(400, { error: 'Time entry id is required.' })
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = commandActorScope(ctx)
    const entry = await findOneWithDecryption(
      em,
      StaffTimeEntry,
      applyScopeToWhere<StaffTimeEntry>({ id, deletedAt: null }, scope),
      undefined,
      scopeForDecryption(scope),
    )
    if (!entry) throw new CrudHttpError(404, { error: 'Time entry not found.' })
    ensureTenantScope(ctx, entry.tenantId)
    ensureOrganizationScope(ctx, entry.organizationId)

    // A closed report renders these minutes; deleting the row would leave the
    // report totalling hours that no longer exist.
    assertTimeEntryUnlocked(entry, (await resolveTranslations()).translate)

    // Ownership enforcement: callers without `staff.timesheets.manage_all`
    // can only delete entries they own.
    const hasManageAll = await callerHasManageAll(ctx)
    if (!hasManageAll) {
      const callerStaffMemberId = await resolveCallerStaffMemberId(em, ctx)
      if (!callerStaffMemberId || entry.staffMemberId !== callerStaffMemberId) {
        const { translate } = await resolveTranslations()
        throw new CrudHttpError(403, {
          error: translate('staff.timesheets.errors.notOwner', 'You can only manage your own time entries.'),
        })
      }
    }

    const settings = await readEntrySettings(ctx, entry.tenantId)
    await assertEntryProjectAccess({
      access: await resolveEntryProjectAccess(em, ctx, entry.tenantId, entry.organizationId, settings),
      hasManageAll,
      projectId: entry.timeProjectId ?? null,
      entryStaffMemberId: entry.staffMemberId,
    })

    entry.deletedAt = new Date()
    entry.updatedAt = new Date()
    await em.flush()

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'deleted',
      entity: entry,
      identifiers: { id: entry.id, organizationId: entry.organizationId, tenantId: entry.tenantId },
      events: staffTimeEntryCrudEvents,
      indexer: timeEntryCrudIndexer,
    })

    return { timeEntryId: entry.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as TimeEntrySnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.timesheets.time_entries.delete', 'Delete time entry'),
      resourceKind: 'staff.timesheets.time_entry',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: {
          before,
        } satisfies TimeEntryUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TimeEntryUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let entry = await em.findOne(StaffTimeEntry, scopedStaffSnapshotWhere(before.id, staffSnapshotScopeFromSnapshot(before)))
    if (!entry) {
      entry = em.create(StaffTimeEntry, {
        id: before.id,
        tenantId: before.tenantId,
        organizationId: before.organizationId,
        staffMemberId: before.staffMemberId,
        date: before.date as unknown as Date,
        durationMinutes: before.durationMinutes,
        roundedMinutes: before.roundedMinutes ?? null,
        startedAt: before.startedAt ? new Date(before.startedAt) : null,
        endedAt: before.endedAt ? new Date(before.endedAt) : null,
        notes: before.notes ?? null,
        timeProjectId: before.timeProjectId ?? null,
        taskId: before.taskId ?? null,
        customerId: before.customerId ?? null,
        dealId: before.dealId ?? null,
        orderId: before.orderId ?? null,
        isBillable: before.isBillable ?? true,
        rateOverrideAmount: before.rateOverrideAmount ?? null,
        rateCurrencyCode: before.rateCurrencyCode ?? null,
        source: (before.source ?? 'manual') as StaffTimeEntrySource,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(entry)
    } else {
      entry.staffMemberId = before.staffMemberId
      entry.date = before.date as unknown as Date
      entry.durationMinutes = before.durationMinutes
      entry.roundedMinutes = before.roundedMinutes ?? null
      entry.startedAt = before.startedAt ? new Date(before.startedAt) : null
      entry.endedAt = before.endedAt ? new Date(before.endedAt) : null
      entry.notes = before.notes ?? null
      entry.timeProjectId = before.timeProjectId ?? null
      entry.taskId = before.taskId ?? null
      entry.customerId = before.customerId ?? null
      entry.dealId = before.dealId ?? null
      entry.orderId = before.orderId ?? null
      entry.isBillable = before.isBillable ?? true
      entry.rateOverrideAmount = before.rateOverrideAmount ?? null
      entry.rateCurrencyCode = before.rateCurrencyCode ?? null
      entry.source = (before.source ?? 'manual') as StaffTimeEntrySource
      entry.deletedAt = null
      entry.updatedAt = new Date()
    }
    await em.flush()

    await emitCrudUndoSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'created',
      entity: entry,
      identifiers: { id: entry.id, organizationId: entry.organizationId, tenantId: entry.tenantId },
      events: staffTimeEntryCrudEvents,
      indexer: timeEntryCrudIndexer,
    })
  },
}

export const staffTimeEntryDuplicateSchema = z.object({
  id: z.string().uuid(),
  // The copy usually lands on another day (US-D6 "log the same thing again"), so
  // the caller may move it; omitted, it keeps the source's day.
  date: z.coerce.date().optional(),
  // US-D6 ends "…I adjust the duration and the date", so both adjustments travel
  // with the copy request rather than costing a second round trip that would
  // leave the unadjusted duration visible in between. Omitted, the copy keeps the
  // source's minutes. The rounded twin is always recomputed by the create command
  // from the tenant rule, so an overridden duration can never carry the source's
  // stale `rounded_minutes` into a new entry (D-7).
  durationMinutes: z.number().int().min(0).max(1440).optional(),
  // Tags are NOT read off the source here: this file writes tags only through the
  // tag commands and never touches `staff_time_entry_tags`, so the caller — which
  // already has the source's `tags[]` from the list response — passes them on.
  tagIds: z.array(z.string().uuid()).max(50).optional(),
})

export type StaffTimeEntryDuplicateInput = z.infer<typeof staffTimeEntryDuplicateSchema>

/**
 * US-D6. The fourth write path TC-TT-018 exercises. It resolves the SOURCE entry
 * and runs it past the lock gate before copying: screen 10 note 4 hides every row
 * action on a locked row, so an API that happily duplicated one would be a side
 * door back into a frozen report's numbers.
 *
 * The copy itself is delegated to the create command rather than re-implemented,
 * so it inherits ownership enforcement, project access, the billable/currency
 * defaults, rounding (D-7), tag syncing and the audit entry unchanged.
 */
const duplicateTimeEntryCommand: CommandHandler<StaffTimeEntryDuplicateInput, { timeEntryId: string }> = {
  id: 'staff.timesheets.time_entries.duplicate',
  async execute(rawInput, ctx) {
    const parsed = staffTimeEntryDuplicateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = commandActorScope(ctx)
    const source = await findOneWithDecryption(
      em,
      StaffTimeEntry,
      applyScopeToWhere<StaffTimeEntry>({ id: parsed.id, deletedAt: null }, scope),
      undefined,
      scopeForDecryption(scope),
    )
    if (!source) throw new CrudHttpError(404, { error: 'Time entry not found.' })
    ensureTenantScope(ctx, source.tenantId)
    ensureOrganizationScope(ctx, source.organizationId)

    assertTimeEntryUnlocked(source, (await resolveTranslations()).translate)

    const bus = ctx.container.resolve('commandBus') as CommandBus
    const created = await bus.execute<unknown, { timeEntryId: string }>(createTimeEntryCommand.id, {
      input: {
        tenantId: source.tenantId,
        organizationId: source.organizationId,
        staffMemberId: source.staffMemberId,
        date: parsed.date ?? source.date,
        durationMinutes: parsed.durationMinutes ?? source.durationMinutes,
        timeProjectId: source.timeProjectId ?? null,
        taskId: source.taskId ?? null,
        customerId: source.customerId ?? null,
        dealId: source.dealId ?? null,
        orderId: source.orderId ?? null,
        isBillable: source.isBillable,
        rateOverrideAmount:
          source.rateOverrideAmount === null || source.rateOverrideAmount === undefined
            ? null
            : Number(source.rateOverrideAmount),
        description: source.notes ?? null,
        // A copy is typed, not timed: carrying `started_at`/`ended_at` over would
        // manufacture an overlap with the entry it was copied from (US-D7).
        source: 'manual' as StaffTimeEntrySource,
        ...(parsed.tagIds !== undefined ? { tagIds: parsed.tagIds } : {}),
      },
      ctx,
    })

    const timeEntryId = created?.result?.timeEntryId
    if (!timeEntryId) throw new CrudHttpError(400, { error: 'Failed to duplicate time entry.' })
    return { timeEntryId }
  },
}

export const staffTimeEntryReapplyRoundingSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  entryIds: z.array(z.string().uuid()).min(1).max(500),
})

export type StaffTimeEntryReapplyRoundingInput = z.infer<typeof staffTimeEntryReapplyRoundingSchema>

export type StaffTimeEntryReapplyRoundingResult = {
  /** Entries whose `rounded_minutes` actually moved. */
  updatedCount: number
  /** Entries already at the current rule — read, compared, left alone. */
  unchangedCount: number
  /** Requested ids that were locked, deleted or out of scope, and therefore never loaded. */
  skippedCount: number
}

/**
 * Retroactive rounding (T7.3, screen 16 note 3) — restates `rounded_minutes` on a
 * batch of existing entries under the tenant's current rule.
 *
 * Three properties, in the order they matter:
 *
 *  1. **A locked entry is unreachable, not merely skipped.** `lockedReportId: null`
 *     is part of the WHERE clause, so an entry frozen into a closed report is never
 *     loaded, never compared and never assigned. The guarantee is structural: there
 *     is no branch in this handler that could write one.
 *  2. **It is an explicit, batched administrative action**, driven by the
 *     `reapply-rounding` ProgressJob worker, never a side effect of saving the
 *     settings form. Rewriting billing history silently is exactly the failure the
 *     spec's risk R1 is about.
 *  3. **It writes one derived column and nothing else.** No clock is re-anchored,
 *     no duration is touched — `duration_minutes` remains the raw observation.
 *
 * Reachable only by a privileged actor: the queue worker (`systemActor`) or a
 * super-admin. An interactive caller cannot rewrite a tenant's history through the
 * command bus by guessing the id; the route that enqueues the job is the gate, and
 * it is gated on `staff.timesheets.settings.manage`.
 */
const reapplyRoundingCommand: CommandHandler<
  StaffTimeEntryReapplyRoundingInput,
  StaffTimeEntryReapplyRoundingResult
> = {
  id: 'staff.timesheets.time_entries.reapply_rounding',
  async execute(input, ctx) {
    const parsed = staffTimeEntryReapplyRoundingSchema.parse(input ?? {})
    if (ctx.systemActor !== true && ctx.auth?.isSuperAdmin !== true) {
      const { translate } = await resolveTranslations()
      throw new CrudHttpError(403, { error: translate('staff.errors.forbidden', 'Forbidden') })
    }

    const scope = commandInputScope(ctx, parsed.tenantId, parsed.organizationId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const settings = await readEntrySettings(ctx, parsed.tenantId)

    const entries = await em.find(
      StaffTimeEntry,
      applyScopeToWhere<StaffTimeEntry>(
        {
          id: { $in: parsed.entryIds },
          deletedAt: null,
          // Non-negotiable: a frozen entry has already been billed at the value it
          // carries, so it is excluded at the query, not at an `if`.
          lockedReportId: null,
        },
        scope,
      ),
    )

    const changed: StaffTimeEntry[] = []
    let unchangedCount = 0
    for (const entry of entries) {
      const next = roundedMinutesFor(entry.durationMinutes, settings)
      if (entry.roundedMinutes === next) {
        unchangedCount += 1
        continue
      }
      entry.roundedMinutes = next
      entry.updatedAt = new Date()
      changed.push(entry)
    }

    if (changed.length > 0) await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as Parameters<
      typeof emitCrudSideEffects
    >[0]['dataEngine']
    for (const entry of changed) {
      await emitCrudSideEffects({
        dataEngine,
        action: 'updated',
        entity: entry,
        identifiers: { id: entry.id, organizationId: entry.organizationId, tenantId: entry.tenantId },
        events: staffTimeEntryCrudEvents,
        indexer: timeEntryCrudIndexer,
      })
    }

    return {
      updatedCount: changed.length,
      unchangedCount,
      skippedCount: Math.max(0, parsed.entryIds.length - entries.length),
    }
  },
}

registerCommand(createTimeEntryCommand)
registerCommand(startTimerCommand)
registerCommand(updateTimeEntryCommand)
registerCommand(deleteTimeEntryCommand)
registerCommand(duplicateTimeEntryCommand)
registerCommand(reapplyRoundingCommand)

export const staffTimeEntryCommandIds = {
  create: createTimeEntryCommand.id,
  startTimer: startTimerCommand.id,
  update: updateTimeEntryCommand.id,
  delete: deleteTimeEntryCommand.id,
  duplicate: duplicateTimeEntryCommand.id,
  reapplyRounding: reapplyRoundingCommand.id,
} as const
