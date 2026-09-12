/**
 * Customer report commands — screens 13, 14 and 15.
 *
 * A report is the one artefact in this module a client can dispute, so the rules
 * it enforces are financial rather than cosmetic:
 *
 *  1. **One customer, one currency (risk R2).** Every selected project must carry
 *     the report's `customerId` and they must all agree on a currency code. A
 *     mismatch is refused with the offending project names rather than silently
 *     averaging two currencies into one number.
 *  2. **The reference is allocated once and never reused** — see
 *     `lib/timesheets-reports/reportReference.ts`. It is printed on a PDF the
 *     client keeps.
 *  3. **A closed report is immutable.** Editing or deleting one is refused with
 *     `409 report_closed`; the way back is the unlock command, which is gated on
 *     its own feature (`staff.timesheets.reports.unlock`) precisely so "who may
 *     restate billed time" is answerable without inventing an admin role.
 *
 * Money is never computed here. `lib/timesheets-reports/reportTotals.ts` owns
 * D-7 (round at the entry, then sum upward) and the close command below feeds
 * its per-entry results straight into the freeze records.
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { buildChanges, emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import {
  StaffTimeEntry,
  StaffTimeProject,
  StaffTimeReport,
  StaffTimeReportEntry,
  StaffTimeReportEvent,
  StaffTimeReportProject,
} from '../data/entities'
import {
  staffTimeReportCloseSchema,
  staffTimeReportCreateSchema,
  staffTimeReportUnlockSchema,
  staffTimeReportUpdateSchema,
  type StaffTimeReportCloseInput,
  type StaffTimeReportCreateInput,
  type StaffTimeReportUnlockInput,
  type StaffTimeReportUpdateInput,
} from '../data/validators'
import { readTimeTrackingSettings } from '../lib/time-tracking/settings'
import {
  allocateReportReference,
  highestReportSequenceNumber,
  isReportReferenceConflict,
  reportReferencePrefix,
  reportReferenceYear,
  withReportReferenceRetry,
} from '../lib/timesheets-reports/reportReference'
import { loadReportData } from '../lib/timesheets-reports/loadReportData'
import { reportSheetLabels } from '../lib/timesheets-reports/reportLabels'
import {
  computeReportTotals,
  resolveEntryValues,
  resolveReportCurrency,
  selectIncludedEntries,
} from '../lib/timesheets-reports/reportTotals'
import { emitStaffEvent } from '../events'
import {
  applyScopeToWhere,
  commandActorScope,
  commandInputScope,
  ensureOrganizationScope,
  ensureTenantScope,
  extractUndoPayload,
  scopedStaffSnapshotWhere,
  staffSnapshotScopeFromContext,
  staffSnapshotScopeFromSnapshot,
  type StaffCommandScope,
  type StaffSnapshotScope,
} from './shared'

export const staffTimeReportCommandIds = {
  create: 'staff.timesheets.reports.create',
  update: 'staff.timesheets.reports.update',
  delete: 'staff.timesheets.reports.delete',
  close: 'staff.timesheets.reports.close',
  unlock: 'staff.timesheets.reports.unlock',
} as const

export const STAFF_TIME_REPORT_RESOURCE_KIND = 'staff.timesheets.time_report'

export const REPORT_CURRENCY_CONFLICT_CODE = 'report_currency_conflict'
export const REPORT_PROJECT_CUSTOMER_MISMATCH_CODE = 'report_project_customer_mismatch'
export const REPORT_PROJECT_NOT_FOUND_CODE = 'report_project_not_found'
export const REPORT_CLOSED_CODE = 'report_closed'
export const REPORT_NOT_CLOSED_CODE = 'report_not_closed'
export const REPORT_REFERENCE_CONFLICT_CODE = 'report_reference_conflict'
export const REPORT_EMPTY_CODE = 'report_empty'

const logger = createLogger('staff').child({ component: 'commands/timesheets-reports' })

const reportCrudIndexer: CrudIndexerConfig<StaffTimeReport> = {
  entityType: 'staff:staff_time_report',
}

const reportCrudEvents: CrudEventsConfig<StaffTimeReport> = {
  module: 'staff',
  entity: 'timesheets.time_report',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

type Translate = (key: string, fallback: string) => string

export type ReportSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  customerId: string
  customerSnapshot: Record<string, unknown> | null
  reference: string
  title: string
  periodKind: string
  periodFrom: string | null
  periodTo: string | null
  currencyCode: string
  grouping: string
  nonbillableMode: string
  includeAlreadyReported: boolean
  showRates: boolean
  roundingUnitMinutes: number
  roundingDirection: string
  status: string
  totalBillableMinutes: number | null
  totalNonbillableMinutes: number | null
  totalAmount: string | null
  closedAt: string | null
  closedByUserId: string | null
  timeProjectIds: string[]
  deletedAt: string | null
}

type ReportUndoPayload = {
  before?: ReportSnapshot | null
  after?: ReportSnapshot | null
}

const DIFFED_FIELDS = [
  'title',
  'periodKind',
  'periodFrom',
  'periodTo',
  'currencyCode',
  'grouping',
  'nonbillableMode',
  'includeAlreadyReported',
  'showRates',
  'status',
  'totalBillableMinutes',
  'totalNonbillableMinutes',
  'totalAmount',
] as const

function toIsoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    const year = value.getFullYear()
    const month = String(value.getMonth() + 1).padStart(2, '0')
    const day = String(value.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
  const text = String(value)
  return text.length >= 10 ? text.slice(0, 10) : text
}

function snapshotScopeWhere(scope?: StaffSnapshotScope | null): { tenantId?: string; organizationId?: string } {
  const where: { tenantId?: string; organizationId?: string } = {}
  if (scope?.tenantId) where.tenantId = scope.tenantId
  if (scope?.organizationId) where.organizationId = scope.organizationId
  return where
}

export async function loadReportProjectIds(
  em: EntityManager,
  reportId: string,
  scope?: StaffSnapshotScope | null,
): Promise<string[]> {
  const rows = await em.find(StaffTimeReportProject, { reportId, ...snapshotScopeWhere(scope) })
  return rows.map((row) => row.timeProjectId)
}

function toSnapshot(report: StaffTimeReport, timeProjectIds: string[]): ReportSnapshot {
  return {
    id: report.id,
    tenantId: report.tenantId,
    organizationId: report.organizationId,
    customerId: report.customerId,
    customerSnapshot: report.customerSnapshot ?? null,
    reference: report.reference,
    title: report.title,
    periodKind: report.periodKind,
    periodFrom: toIsoDate(report.periodFrom),
    periodTo: toIsoDate(report.periodTo),
    currencyCode: report.currencyCode,
    grouping: report.grouping,
    nonbillableMode: report.nonbillableMode,
    includeAlreadyReported: report.includeAlreadyReported ?? false,
    showRates: report.showRates ?? true,
    roundingUnitMinutes: report.roundingUnitMinutes ?? 0,
    roundingDirection: report.roundingDirection ?? 'up',
    status: report.status,
    totalBillableMinutes: report.totalBillableMinutes ?? null,
    totalNonbillableMinutes: report.totalNonbillableMinutes ?? null,
    totalAmount: report.totalAmount ?? null,
    closedAt: report.closedAt ? report.closedAt.toISOString() : null,
    closedByUserId: report.closedByUserId ?? null,
    timeProjectIds,
    deletedAt: report.deletedAt ? report.deletedAt.toISOString() : null,
  }
}

export async function loadReportSnapshot(
  em: EntityManager,
  id: string,
  scope?: StaffSnapshotScope | null,
): Promise<ReportSnapshot | null> {
  const report = await em.findOne(StaffTimeReport, scopedStaffSnapshotWhere(id, scope))
  if (!report) return null
  const projectIds = await loadReportProjectIds(em, report.id, scope)
  return toSnapshot(report, projectIds)
}

export function reportNotFoundError(translate: Translate): CrudHttpError {
  return new CrudHttpError(404, {
    error: translate('staff.time_tracking.reports.errors.notFound', 'Report not found or not accessible.'),
  })
}

export function reportClosedError(translate: Translate, reference: string | null): CrudHttpError {
  return new CrudHttpError(409, {
    code: REPORT_CLOSED_CODE,
    error: translate(
      'staff.time_tracking.reports.errors.closed',
      'This report is closed. Unlock it before changing anything.',
    ),
    reference: reference ?? null,
  })
}

function projectsRequiredError(translate: Translate): CrudHttpError {
  const message = translate(
    'staff.time_tracking.reports.errors.projectsRequired',
    'Pick at least one project for this report.',
  )
  return new CrudHttpError(422, { error: message, fieldErrors: { timeProjectIds: message } })
}

function projectNotFoundError(translate: Translate, missingIds: string[]): CrudHttpError {
  const message = translate(
    'staff.time_tracking.reports.errors.projectNotFound',
    'Some of the selected projects are not available.',
  )
  return new CrudHttpError(422, {
    code: REPORT_PROJECT_NOT_FOUND_CODE,
    error: message,
    fieldErrors: { timeProjectIds: message },
    missingProjectIds: missingIds,
  })
}

function customerMismatchError(translate: Translate, offenders: string[]): CrudHttpError {
  const message = translate(
    'staff.time_tracking.reports.errors.customerMismatch',
    'A report always covers one customer. These projects belong to someone else: {projects}.',
  ).replace('{projects}', offenders.join(', '))
  return new CrudHttpError(422, {
    code: REPORT_PROJECT_CUSTOMER_MISMATCH_CODE,
    error: message,
    fieldErrors: { timeProjectIds: message },
    offenders,
  })
}

/**
 * Risk R2 refused at the cheapest point. The body names both the currencies and
 * the projects carrying them, because "pick one currency" is unactionable
 * without knowing which project is the odd one out.
 */
export function currencyConflictError(
  translate: Translate,
  currencies: string[],
  offenders: Array<{ id: string; name: string; currencyCode: string | null }>,
): CrudHttpError {
  const message = translate(
    'staff.time_tracking.reports.errors.currencyConflict',
    'A report always covers one currency. Selected projects use {currencies}.',
  ).replace('{currencies}', currencies.join(', '))
  return new CrudHttpError(422, {
    code: REPORT_CURRENCY_CONFLICT_CODE,
    error: message,
    fieldErrors: { timeProjectIds: message },
    currencies,
    offenders: offenders.map((project) => ({
      id: project.id,
      name: project.name,
      currencyCode: project.currencyCode ?? null,
    })),
  })
}

function referenceConflictError(translate: Translate): CrudHttpError {
  return new CrudHttpError(409, {
    code: REPORT_REFERENCE_CONFLICT_CODE,
    error: translate(
      'staff.time_tracking.reports.errors.referenceConflict',
      'Could not allocate a report number right now. Try again.',
    ),
  })
}

export type ResolvedReportProjects = {
  projects: StaffTimeProject[]
  currencyCode: string
}

/**
 * The single validation gate every write shares: the projects exist in scope,
 * they all belong to the report's customer, and they agree on a currency.
 */
export async function resolveReportProjects(
  em: EntityManager,
  timeProjectIds: readonly string[],
  customerId: string,
  scope: StaffCommandScope,
  translate: Translate,
): Promise<ResolvedReportProjects> {
  const ids = Array.from(new Set(timeProjectIds.filter((id) => typeof id === 'string' && id.length > 0)))
  if (ids.length === 0) throw projectsRequiredError(translate)

  const projects = await em.find(
    StaffTimeProject,
    applyScopeToWhere<StaffTimeProject>({ id: { $in: ids }, deletedAt: null }, scope),
  )
  if (projects.length !== ids.length) {
    const found = new Set(projects.map((project) => project.id))
    throw projectNotFoundError(
      translate,
      ids.filter((id) => !found.has(id)),
    )
  }

  const mismatched = projects.filter((project) => (project.customerId ?? null) !== customerId)
  if (mismatched.length > 0) {
    throw customerMismatchError(
      translate,
      mismatched.map((project) => project.name),
    )
  }

  const resolution = resolveReportCurrency(
    projects.map((project) => ({
      id: project.id,
      name: project.name,
      currencyCode: project.currencyCode ?? null,
    })),
  )
  if (!resolution.ok) {
    throw currencyConflictError(translate, resolution.currencies, resolution.offenders)
  }

  return { projects, currencyCode: resolution.currencyCode ?? '' }
}

/**
 * D-9: the report carries the customer as an FK id plus a denormalized snapshot,
 * so the sheet header resolves a client name without joining the customers
 * module — and keeps resolving it if that customer is later removed. The
 * snapshot is taken from the selected projects, which already carry one, rather
 * than reaching across the module boundary a second time.
 */
export function deriveCustomerSnapshot(projects: readonly StaffTimeProject[]): Record<string, unknown> | null {
  for (const project of projects) {
    const snapshot = project.customerSnapshot
    if (snapshot && typeof snapshot === 'object' && Object.keys(snapshot).length > 0) {
      return snapshot as Record<string, unknown>
    }
  }
  return null
}

async function readRoundingSnapshot(
  ctx: CommandRuntimeContext,
  tenantId: string,
): Promise<{ unitMinutes: number; direction: string }> {
  try {
    const configService = ctx.container.resolve('moduleConfigService') as ModuleConfigService
    const settings = await readTimeTrackingSettings(configService, { tenantId })
    return { unitMinutes: settings.rounding.unitMinutes, direction: settings.rounding.direction }
  } catch (err) {
    // A draft that cannot read the rule still has to exist; close re-stamps it.
    logger.warn('staff.timesheets.reports rounding snapshot unavailable', { err })
    return { unitMinutes: 0, direction: 'up' }
  }
}

async function replaceReportProjects(
  em: EntityManager,
  report: StaffTimeReport,
  projects: readonly StaffTimeProject[],
): Promise<void> {
  const existing = await em.find(StaffTimeReportProject, { reportId: report.id })
  for (const row of existing) em.remove(row)
  for (const project of projects) {
    em.persist(
      em.create(StaffTimeReportProject, {
        tenantId: report.tenantId,
        organizationId: report.organizationId,
        reportId: report.id,
        timeProjectId: project.id,
        createdAt: new Date(),
      }),
    )
  }
}

function actorUserId(ctx: CommandRuntimeContext): string | null {
  return typeof ctx.auth?.sub === 'string' ? ctx.auth.sub : null
}

/**
 * The highest report number the organization has EVER handed out this year,
 * soft-deleted rows included. The unique index covers live rows only, so a
 * deleted `RAP-2026-0042` would otherwise be reissued behind a PDF a client
 * already holds.
 */
async function readHighestReportSequence(
  em: EntityManager,
  year: number,
  scope: StaffCommandScope,
): Promise<number> {
  const rows = await em.find(
    StaffTimeReport,
    applyScopeToWhere<StaffTimeReport>({ reference: { $like: `${reportReferencePrefix(year)}%` } }, scope),
  )
  return highestReportSequenceNumber(
    rows.map((row) => row.reference),
    year,
  )
}

const createReportCommand: CommandHandler<StaffTimeReportCreateInput, { reportId: string }> = {
  id: staffTimeReportCommandIds.create,
  async execute(rawInput, ctx) {
    const parsed = staffTimeReportCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const scope = commandInputScope(ctx, parsed.tenantId, parsed.organizationId)
    const { translate } = await resolveTranslations()
    const baseEm = ctx.container.resolve('em') as EntityManager
    const createdByUserId = actorUserId(ctx)
    const rounding = await readRoundingSnapshot(ctx, parsed.tenantId)
    const issuedAt = new Date()
    const year = reportReferenceYear(issuedAt)

    let record: StaffTimeReport
    try {
      record = await withReportReferenceRetry(async () => {
        // A fresh fork per attempt: a lost race aborts the transaction, so the
        // retry re-reads the highest reference rather than reusing a stale max.
        const em = baseEm.fork()
        let created: StaffTimeReport | null = null
        let plan: { projects: StaffTimeProject[]; currencyCode: string; highest: number } | null = null

        await withAtomicFlush(
          em,
          [
            async () => {
              const resolved = await resolveReportProjects(
                em,
                parsed.timeProjectIds,
                parsed.customerId,
                scope,
                translate,
              )
              plan = {
                projects: resolved.projects,
                currencyCode: resolved.currencyCode,
                highest: await readHighestReportSequence(em, year, scope),
              }
            },
            () => {
              if (!plan) throw reportNotFoundError(translate)
              const allocation = allocateReportReference(year, plan.highest)
              const now = new Date()
              created = em.create(StaffTimeReport, {
                tenantId: parsed.tenantId,
                organizationId: parsed.organizationId,
                customerId: parsed.customerId,
                customerSnapshot: deriveCustomerSnapshot(plan.projects),
                reference: allocation.reference,
                title: parsed.title,
                periodKind: parsed.periodKind,
                periodFrom: parsed.periodFrom,
                periodTo: parsed.periodTo,
                currencyCode: plan.currencyCode,
                grouping: parsed.grouping,
                nonbillableMode: parsed.nonbillableMode,
                includeAlreadyReported: parsed.includeAlreadyReported,
                showRates: parsed.showRates,
                roundingUnitMinutes: rounding.unitMinutes,
                roundingDirection: rounding.direction,
                status: 'draft',
                createdByUserId,
                createdAt: now,
                updatedAt: now,
                deletedAt: null,
              })
              em.persist(created)
            },
            async () => {
              if (!created || !plan) return
              await replaceReportProjects(em, created, plan.projects)
            },
          ],
          { transaction: true, label: staffTimeReportCommandIds.create },
        )

        if (!created) throw reportNotFoundError(translate)
        return created as StaffTimeReport
      })
    } catch (err) {
      if (isReportReferenceConflict(err)) throw referenceConflictError(translate)
      throw err
    }

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'created',
      entity: record,
      identifiers: { id: record.id, organizationId: record.organizationId, tenantId: record.tenantId },
      events: reportCrudEvents,
      indexer: reportCrudIndexer,
    })

    return { reportId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadReportSnapshot(em, result.reportId, staffSnapshotScopeFromContext(ctx))
    if (!snapshot) return null
    return { snapshot }
  },
  buildLog: async ({ result, ctx }) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadReportSnapshot(em, result.reportId, staffSnapshotScopeFromContext(ctx))
    if (!snapshot) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.timesheets.reports.create', 'Create report'),
      resourceKind: STAFF_TIME_REPORT_RESOURCE_KIND,
      resourceId: snapshot.id,
      tenantId: snapshot.tenantId,
      organizationId: snapshot.organizationId,
      snapshotAfter: snapshot,
      payload: { undo: { after: snapshot } satisfies ReportUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ReportUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const report = await em.findOne(
      StaffTimeReport,
      scopedStaffSnapshotWhere(after.id, staffSnapshotScopeFromSnapshot(after)),
    )
    if (!report) return
    // A report that has since been closed froze entries; undoing its creation
    // would strand those locks, so the undo declines rather than half-unwinding.
    if (report.status === 'closed') return
    report.deletedAt = new Date()
    report.updatedAt = new Date()
    await em.flush()

    await emitCrudUndoSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'deleted',
      entity: report,
      identifiers: { id: report.id, organizationId: report.organizationId, tenantId: report.tenantId },
      events: reportCrudEvents,
      indexer: reportCrudIndexer,
    })
  },
}

const updateReportCommand: CommandHandler<StaffTimeReportUpdateInput, { reportId: string }> = {
  id: staffTimeReportCommandIds.update,
  async prepare(rawInput, ctx) {
    const parsed = staffTimeReportUpdateSchema.safeParse(rawInput)
    if (!parsed.success) return {}
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const before = await loadReportSnapshot(em, parsed.data.id, staffSnapshotScopeFromContext(ctx))
    if (!before) return {}
    return { before: { snapshot: before } }
  },
  async execute(rawInput, ctx) {
    const parsed = staffTimeReportUpdateSchema.parse(rawInput)
    const { translate } = await resolveTranslations()
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = commandActorScope(ctx)

    const report = await em.findOne(
      StaffTimeReport,
      applyScopeToWhere<StaffTimeReport>({ id: parsed.id, deletedAt: null }, scope),
    )
    if (!report) throw reportNotFoundError(translate)
    ensureTenantScope(ctx, report.tenantId)
    ensureOrganizationScope(ctx, report.organizationId)
    if (report.status === 'closed') throw reportClosedError(translate, report.reference)

    const targetCustomerId = parsed.customerId ?? report.customerId
    let resolved: ResolvedReportProjects | null = null

    await withAtomicFlush(
      em,
      [
        async () => {
          const needsProjectCheck =
            parsed.timeProjectIds !== undefined || (parsed.customerId !== undefined && parsed.customerId !== report.customerId)
          if (!needsProjectCheck) return
          const ids = parsed.timeProjectIds ?? (await loadReportProjectIds(em, report.id, scope))
          resolved = await resolveReportProjects(em, ids, targetCustomerId, scope, translate)
        },
        () => {
          const now = new Date()
          if (parsed.title !== undefined) report.title = parsed.title
          if (parsed.periodKind !== undefined) report.periodKind = parsed.periodKind
          if (parsed.periodFrom !== undefined) report.periodFrom = parsed.periodFrom
          if (parsed.periodTo !== undefined) report.periodTo = parsed.periodTo
          if (parsed.grouping !== undefined) report.grouping = parsed.grouping
          if (parsed.nonbillableMode !== undefined) report.nonbillableMode = parsed.nonbillableMode
          if (parsed.includeAlreadyReported !== undefined) {
            report.includeAlreadyReported = parsed.includeAlreadyReported
          }
          if (parsed.showRates !== undefined) report.showRates = parsed.showRates
          if (parsed.customerId !== undefined) report.customerId = parsed.customerId
          if (resolved) {
            report.currencyCode = resolved.currencyCode
            report.customerSnapshot = deriveCustomerSnapshot(resolved.projects) ?? report.customerSnapshot ?? null
          }
          report.updatedAt = now
        },
        async () => {
          if (!resolved || parsed.timeProjectIds === undefined) return
          await replaceReportProjects(em, report, resolved.projects)
        },
      ],
      { transaction: true, label: staffTimeReportCommandIds.update },
    )

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'updated',
      entity: report,
      identifiers: { id: report.id, organizationId: report.organizationId, tenantId: report.tenantId },
      events: reportCrudEvents,
      indexer: reportCrudIndexer,
    })

    return { reportId: report.id }
  },
  buildLog: async ({ snapshots, ctx }) => {
    const before = (snapshots.before as { snapshot?: ReportSnapshot } | undefined)?.snapshot
    if (!before) return null
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const after = await loadReportSnapshot(em, before.id, staffSnapshotScopeFromSnapshot(before))
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.timesheets.reports.update', 'Update report'),
      resourceKind: STAFF_TIME_REPORT_RESOURCE_KIND,
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      changes: buildChanges(
        before as unknown as Record<string, unknown>,
        after as unknown as Record<string, unknown>,
        [...DIFFED_FIELDS],
      ),
      payload: { undo: { before, after } satisfies ReportUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ReportUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const report = await em.findOne(
      StaffTimeReport,
      scopedStaffSnapshotWhere(before.id, staffSnapshotScopeFromSnapshot(before)),
    )
    if (!report) return
    if (report.status === 'closed') return

    const projects = await em.find(StaffTimeProject, {
      id: { $in: before.timeProjectIds },
      tenantId: before.tenantId,
      organizationId: before.organizationId,
    })

    await withAtomicFlush(
      em,
      [
        () => {
          report.customerId = before.customerId
          report.customerSnapshot = before.customerSnapshot
          report.title = before.title
          report.periodKind = before.periodKind as StaffTimeReport['periodKind']
          if (before.periodFrom) report.periodFrom = new Date(before.periodFrom)
          if (before.periodTo) report.periodTo = new Date(before.periodTo)
          report.currencyCode = before.currencyCode
          report.grouping = before.grouping as StaffTimeReport['grouping']
          report.nonbillableMode = before.nonbillableMode as StaffTimeReport['nonbillableMode']
          report.includeAlreadyReported = before.includeAlreadyReported
          report.showRates = before.showRates
          report.updatedAt = new Date()
        },
        async () => {
          if (projects.length !== before.timeProjectIds.length) return
          await replaceReportProjects(em, report, projects)
        },
      ],
      { transaction: true, label: `${staffTimeReportCommandIds.update}.undo` },
    )

    await emitCrudUndoSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'updated',
      entity: report,
      identifiers: { id: report.id, organizationId: report.organizationId, tenantId: report.tenantId },
      events: reportCrudEvents,
      indexer: reportCrudIndexer,
    })
  },
}

const deleteReportCommand: CommandHandler<{ id?: string }, { reportId: string }> = {
  id: staffTimeReportCommandIds.delete,
  async prepare(input, ctx) {
    const id = input?.id
    if (!id) return {}
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const before = await loadReportSnapshot(em, id, staffSnapshotScopeFromContext(ctx))
    if (!before) return {}
    return { before: { snapshot: before } }
  },
  async execute(input, ctx) {
    const { translate } = await resolveTranslations()
    const id = input?.id
    if (!id) {
      throw new CrudHttpError(400, {
        error: translate('staff.time_tracking.reports.errors.idRequired', 'Report id is required.'),
      })
    }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = commandActorScope(ctx)
    const report = await em.findOne(
      StaffTimeReport,
      applyScopeToWhere<StaffTimeReport>({ id, deletedAt: null }, scope),
    )
    if (!report) throw reportNotFoundError(translate)
    ensureTenantScope(ctx, report.tenantId)
    ensureOrganizationScope(ctx, report.organizationId)
    // Deleting a closed report would strand every entry it froze: their
    // `locked_report_id` would point at a row nothing can unlock.
    if (report.status === 'closed') throw reportClosedError(translate, report.reference)

    const now = new Date()
    report.deletedAt = now
    report.updatedAt = now
    await em.flush()

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'deleted',
      entity: report,
      identifiers: { id: report.id, organizationId: report.organizationId, tenantId: report.tenantId },
      events: reportCrudEvents,
      indexer: reportCrudIndexer,
    })

    return { reportId: report.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = (snapshots.before as { snapshot?: ReportSnapshot } | undefined)?.snapshot
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.timesheets.reports.delete', 'Delete report'),
      resourceKind: STAFF_TIME_REPORT_RESOURCE_KIND,
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: { undo: { before } satisfies ReportUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ReportUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const report = await em.findOne(
      StaffTimeReport,
      scopedStaffSnapshotWhere(before.id, staffSnapshotScopeFromSnapshot(before)),
    )
    if (!report) return
    report.deletedAt = null
    report.updatedAt = new Date()
    await em.flush()

    await emitCrudUndoSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'created',
      entity: report,
      identifiers: { id: report.id, organizationId: report.organizationId, tenantId: report.tenantId },
      events: reportCrudEvents,
      indexer: reportCrudIndexer,
    })
  },
}

registerCommand(createReportCommand)
registerCommand(updateReportCommand)
registerCommand(deleteReportCommand)

/**
 * US-G3 — close & lock. This is the only place a lock is created: exporting a
 * PDF freezes nothing (screen 14 note 5), because "in a generated/sent report"
 * (§9) is ambiguous and a download that silently locks a team's timesheet is the
 * worse reading of it.
 *
 * Everything the close writes happens inside ONE `withAtomicFlush({ transaction:
 * true })`: the per-entry freeze records, the `locked_report_id` stamps, the
 * frozen report totals and the `closed` audit event. A partial close would leave
 * entries frozen against a report that never closed — unlockable by nobody,
 * because the unlock command refuses a draft.
 *
 * Two rules that are easy to get wrong:
 *
 *  - **The freeze records come from the same `selectIncludedEntries` /
 *    `resolveEntryValues` pair the sheet printed**, so what is frozen is by
 *    construction what the client was shown. The amounts are already rounded at
 *    the entry (D-7), which is what lets `total_amount` be an exact sum.
 *  - **An entry already locked by another report keeps that lock.** When the
 *    D-5 opt-in pulls a previously billed hour into a second report, this report
 *    records what it billed, but ownership of the lock stays with the report
 *    that froze it first — otherwise unlocking the earlier report would leave
 *    the hour editable while a later closed report still quotes it.
 */
export type StaffTimeReportCloseResult = {
  reportId: string
  lockedEntryCount: number
  totalAmount: number
  totalBillableMinutes: number
  totalNonbillableMinutes: number
}

function reportNotClosedError(translate: Translate): CrudHttpError {
  return new CrudHttpError(409, {
    code: REPORT_NOT_CLOSED_CODE,
    error: translate(
      'staff.time_tracking.reports.errors.notClosed',
      'This report is not closed, so there is nothing to unlock.',
    ),
  })
}

function reportEmptyError(translate: Translate): CrudHttpError {
  return new CrudHttpError(422, {
    code: REPORT_EMPTY_CODE,
    error: translate(
      'staff.time_tracking.reports.errors.empty',
      'This report covers no time entries, so there is nothing to freeze. Adjust the period or the project selection first.',
    ),
  })
}

const closeReportCommand: CommandHandler<StaffTimeReportCloseInput, StaffTimeReportCloseResult> = {
  id: staffTimeReportCommandIds.close,
  async prepare(rawInput, ctx) {
    const parsed = staffTimeReportCloseSchema.safeParse(rawInput)
    if (!parsed.success) return {}
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const before = await loadReportSnapshot(em, parsed.data.id, staffSnapshotScopeFromContext(ctx))
    if (!before) return {}
    return { before: { snapshot: before } }
  },
  async execute(rawInput, ctx) {
    const parsed = staffTimeReportCloseSchema.parse(rawInput)
    const { translate } = await resolveTranslations()
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = commandActorScope(ctx)

    const report = await em.findOne(
      StaffTimeReport,
      applyScopeToWhere<StaffTimeReport>({ id: parsed.id, deletedAt: null }, scope),
    )
    if (!report) throw reportNotFoundError(translate)
    ensureTenantScope(ctx, report.tenantId)
    ensureOrganizationScope(ctx, report.organizationId)
    if (report.status === 'closed') throw reportClosedError(translate, report.reference)

    const dataScope = { tenantId: report.tenantId, organizationId: report.organizationId }
    const rounding = await readRoundingSnapshot(ctx, report.tenantId)
    const actorId = actorUserId(ctx)
    const labels = reportSheetLabels(translate)

    type ClosePlanItem = {
      entry: ReturnType<typeof selectIncludedEntries>[number]
      row: StaffTimeEntry | null
      values: ReturnType<typeof resolveEntryValues>
      currencyCode: string
    }

    let lockedEntryCount = 0
    let totals: ReturnType<typeof computeReportTotals> | null = null
    let closePlan: ClosePlanItem[] = []

    await withAtomicFlush(
      em,
      [
        async () => {
          const timeProjectIds = await loadReportProjectIds(em, report.id, dataScope)
          const data = await loadReportData({
            em,
            scope: dataScope,
            timeProjectIds,
            periodFrom: report.periodFrom,
            periodTo: report.periodTo,
          })
          const options = {
            grouping: report.grouping,
            nonbillableMode: report.nonbillableMode,
            includeAlreadyReported: report.includeAlreadyReported ?? false,
          } as const
          const included = selectIncludedEntries(data.entries, options, report.id)
          if (included.length === 0) throw reportEmptyError(translate)

          totals = computeReportTotals({
            entries: data.entries,
            projects: data.projects,
            directory: data.directory,
            options,
            currentReportId: report.id,
            labels,
          })

          const projectById = new Map(data.projects.map((project) => [project.id, project]))
          const entryRows = await em.find(StaffTimeEntry, {
            id: { $in: included.map((entry) => entry.id) },
            tenantId: report.tenantId,
            organizationId: report.organizationId,
          })
          const entryById = new Map(entryRows.map((row) => [row.id, row]))

          closePlan = included.map((entry) => ({
            entry,
            row: entryById.get(entry.id) ?? null,
            values: resolveEntryValues(entry, projectById.get(entry.timeProjectId) ?? null),
            currencyCode:
              projectById.get(entry.timeProjectId)?.currencyCode ?? report.currencyCode ?? '',
          }))
        },
        () => {
          if (!totals) throw reportEmptyError(translate)
          const now = new Date()
          for (const item of closePlan) {
            em.persist(
              em.create(StaffTimeReportEntry, {
                tenantId: report.tenantId,
                organizationId: report.organizationId,
                reportId: report.id,
                timeEntryId: item.entry.id,
                frozenRawMinutes: item.values.rawMinutes,
                frozenRoundedMinutes: item.values.minutes,
                frozenRateAmount: item.values.rate === null ? null : String(item.values.rate),
                frozenCurrencyCode: item.currencyCode,
                frozenAmount: item.values.amount === null ? null : item.values.amount.toFixed(2),
                frozenIsBillable: item.values.isBillable,
                createdAt: now,
              }),
            )
            const row = item.row
            if (!row) continue
            // Ownership of an existing lock is never transferred — see the note
            // on this command.
            if (row.lockedReportId) continue
            row.lockedReportId = report.id
            row.lockedAt = now
            row.updatedAt = now
            lockedEntryCount += 1
          }

          report.status = 'closed'
          report.closedAt = now
          report.closedByUserId = actorId
          report.roundingUnitMinutes = rounding.unitMinutes
          report.roundingDirection = rounding.direction
          report.totalBillableMinutes = totals.billableMinutes
          report.totalNonbillableMinutes = totals.nonbillableMinutes
          report.totalAmount = totals.totalAmount.toFixed(2)
          report.updatedAt = now

          em.persist(
            em.create(StaffTimeReportEvent, {
              tenantId: report.tenantId,
              organizationId: report.organizationId,
              reportId: report.id,
              eventType: 'closed',
              reason: null,
              actorUserId: actorId,
              metadata: {
                frozenEntryCount: closePlan.length,
                lockedEntryCount,
                totalAmount: totals.totalAmount,
                currencyCode: report.currencyCode,
                roundingUnitMinutes: rounding.unitMinutes,
                roundingDirection: rounding.direction,
              },
              createdAt: now,
            }),
          )
        },
      ],
      { transaction: true, label: staffTimeReportCommandIds.close },
    )

    const resolved = totals as ReturnType<typeof computeReportTotals> | null
    const result: StaffTimeReportCloseResult = {
      reportId: report.id,
      lockedEntryCount,
      totalAmount: resolved?.totalAmount ?? 0,
      totalBillableMinutes: resolved?.billableMinutes ?? 0,
      totalNonbillableMinutes: resolved?.nonbillableMinutes ?? 0,
    }

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'updated',
      entity: report,
      identifiers: { id: report.id, organizationId: report.organizationId, tenantId: report.tenantId },
      events: reportCrudEvents,
      indexer: reportCrudIndexer,
    })

    // A failed broadcast must never fail a committed close.
    //
    // The payload is spelled out rather than spreading `result` because this event is
    // `clientBroadcast: true`: the DOM Event Bridge delivers it to every user of the
    // organization with no feature check, and `result.totalAmount` is money, which is
    // gated on `staff.timesheets.rates.view`. The minute totals and the locked-entry
    // count are not money and are what a live report screen needs; the amount is read
    // back from the report itself by a caller entitled to it.
    //
    // What else that unfiltered audience decides, field by field:
    //
    //  - `customerId` is DROPPED. It is the one field that links a report to a named
    //    client, and one organization serves many; a tenant's whole staff learning
    //    which client was billed this week is a disclosure with no consumer asking
    //    for it. The schema always declared it optional, both in-repo subscribers
    //    re-read the report from the database, and the portal mirror
    //    (`time_report.portal_published`) resolves the customer itself.
    //  - `reference` and the two minute totals STAY. They are stable identifiers and
    //    non-money aggregates, they are the published webhook contract an external
    //    billing system codes against, and they are what a live reports screen needs
    //    to refresh a row. Narrowing them further is not expressible here: the DOM
    //    bridge can only pin an audience by user or ROLE id, and this module
    //    deliberately gates on immutable feature ids rather than mutable roles.
    void emitStaffEvent('staff.timesheets.time_report.closed', {
      id: report.id,
      tenantId: report.tenantId,
      organizationId: report.organizationId,
      reference: report.reference,
      reportId: result.reportId,
      lockedEntryCount: result.lockedEntryCount,
      totalBillableMinutes: result.totalBillableMinutes,
      totalNonbillableMinutes: result.totalNonbillableMinutes,
    }).catch((err) => {
      logger.error('staff.timesheets emit time_report.closed failed', { err })
    })

    // The close froze `lockedEntryCount` entries. The entry-scoped subscribers key
    // off a single record id, so this batch-level notice carries none and reaches
    // only the ones that care about a period being frozen.
    if (lockedEntryCount > 0) {
      void emitStaffEvent('staff.timesheets.time_entry.locked', {
        tenantId: report.tenantId,
        organizationId: report.organizationId,
        reportId: report.id,
        lockedEntryCount,
      }).catch((err) => {
        logger.error('staff.timesheets emit time_entry.locked failed', { err })
      })
    }

    return result
  },
  buildLog: async ({ snapshots, ctx }) => {
    const before = (snapshots.before as { snapshot?: ReportSnapshot } | undefined)?.snapshot
    if (!before) return null
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const after = await loadReportSnapshot(em, before.id, staffSnapshotScopeFromSnapshot(before))
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.timesheets.reports.close', 'Close and lock report'),
      resourceKind: STAFF_TIME_REPORT_RESOURCE_KIND,
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      changes: buildChanges(
        before as unknown as Record<string, unknown>,
        after as unknown as Record<string, unknown>,
        [...DIFFED_FIELDS],
      ),
      // Deliberately no `undo` payload: unwinding a close is the unlock command,
      // which requires a reason and its own feature. A silent undo of a billing
      // freeze is exactly what US-G3 forbids.
    }
  },
}

/**
 * US-G3's other half — unlock, screen 15.
 *
 * Three things make it an "explicit, audited action" rather than a confirm
 * dialog: it takes a mandatory reason, it appends an `unlocked` event carrying
 * that reason and the actor, and it is gated on `staff.timesheets.reports.unlock`
 * — a feature distinct from `staff.timesheets.lock`, so "who may restate billed
 * time" can be answered by withholding it from a Team Leader without inventing
 * the admin role §10 rejects.
 *
 * The freeze records are DELETED rather than kept. Two reasons: `staff_time_
 * report_entries` is what makes D-5 answerable ("is this hour already billed?"),
 * so leaving stale rows behind after the report reopened would keep hours out of
 * the next invoice for no reason; and the unique `(report_id, time_entry_id)`
 * index would otherwise refuse the re-close. The numbers they held are copied
 * into the `unlocked` event's metadata, so the audit trail keeps what was
 * frozen.
 */
export type StaffTimeReportUnlockResult = {
  reportId: string
  unlockedEntryCount: number
}

const unlockReportCommand: CommandHandler<StaffTimeReportUnlockInput, StaffTimeReportUnlockResult> = {
  id: staffTimeReportCommandIds.unlock,
  async prepare(rawInput, ctx) {
    const parsed = staffTimeReportUnlockSchema.safeParse(rawInput)
    if (!parsed.success) return {}
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const before = await loadReportSnapshot(em, parsed.data.id, staffSnapshotScopeFromContext(ctx))
    if (!before) return {}
    return { before: { snapshot: before } }
  },
  async execute(rawInput, ctx) {
    const parsed = staffTimeReportUnlockSchema.parse(rawInput)
    const { translate } = await resolveTranslations()
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = commandActorScope(ctx)

    const report = await em.findOne(
      StaffTimeReport,
      applyScopeToWhere<StaffTimeReport>({ id: parsed.id, deletedAt: null }, scope),
    )
    if (!report) throw reportNotFoundError(translate)
    ensureTenantScope(ctx, report.tenantId)
    ensureOrganizationScope(ctx, report.organizationId)
    if (report.status !== 'closed') throw reportNotClosedError(translate)

    const actorId = actorUserId(ctx)
    let unlockedEntryCount = 0
    let frozenEntries: StaffTimeReportEntry[] = []
    let lockedRows: StaffTimeEntry[] = []
    const frozenTotals = {
      totalAmount: report.totalAmount,
      totalBillableMinutes: report.totalBillableMinutes ?? null,
      totalNonbillableMinutes: report.totalNonbillableMinutes ?? null,
    }

    await withAtomicFlush(
      em,
      [
        async () => {
          frozenEntries = await em.find(StaffTimeReportEntry, {
            reportId: report.id,
            tenantId: report.tenantId,
            organizationId: report.organizationId,
          })
          lockedRows = await em.find(StaffTimeEntry, {
            lockedReportId: report.id,
            tenantId: report.tenantId,
            organizationId: report.organizationId,
          })
        },
        () => {
          const now = new Date()
          for (const row of lockedRows) {
            row.lockedReportId = null
            row.lockedAt = null
            row.updatedAt = now
            unlockedEntryCount += 1
          }
          for (const frozen of frozenEntries) em.remove(frozen)

          report.status = 'draft'
          report.closedAt = null
          report.closedByUserId = null
          report.totalAmount = null
          report.totalBillableMinutes = null
          report.totalNonbillableMinutes = null
          report.updatedAt = now

          em.persist(
            em.create(StaffTimeReportEvent, {
              tenantId: report.tenantId,
              organizationId: report.organizationId,
              reportId: report.id,
              eventType: 'unlocked',
              reason: parsed.reason,
              actorUserId: actorId,
              metadata: {
                unlockedEntryCount,
                frozenEntryCount: frozenEntries.length,
                frozenTotalAmount: frozenTotals.totalAmount,
                frozenBillableMinutes: frozenTotals.totalBillableMinutes,
                frozenNonbillableMinutes: frozenTotals.totalNonbillableMinutes,
                currencyCode: report.currencyCode,
              },
              createdAt: now,
            }),
          )
        },
      ],
      { transaction: true, label: staffTimeReportCommandIds.unlock },
    )

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'updated',
      entity: report,
      identifiers: { id: report.id, organizationId: report.organizationId, tenantId: report.tenantId },
      events: reportCrudEvents,
      indexer: reportCrudIndexer,
    })

    // `reason` is deliberately NOT on the wire.
    //
    // This event is `clientBroadcast: true`, and the DOM Event Bridge filters a
    // broadcast by tenant + organization only — no feature check — so every
    // signed-in user of the organization receives whatever the payload carries.
    // `reason` is mandatory operator prose of up to 2000 characters explaining why
    // a client's billing was reopened; broadcasting it organization-wide is a
    // disclosure the screen it comes from (`staff.timesheets.reports.unlock`) does
    // not make. It is already persisted verbatim on the `StaffTimeReportEvent`
    // audit row above, which is read behind the ACL, so nothing is lost.
    void emitStaffEvent('staff.timesheets.time_report.unlocked', {
      id: report.id,
      tenantId: report.tenantId,
      organizationId: report.organizationId,
      reference: report.reference,
      actorUserId: actorId,
      unlockedEntryCount,
    }).catch((err) => {
      logger.error('staff.timesheets emit time_report.unlocked failed', { err })
    })

    if (unlockedEntryCount > 0) {
      void emitStaffEvent('staff.timesheets.time_entry.unlocked', {
        tenantId: report.tenantId,
        organizationId: report.organizationId,
        reportId: report.id,
        unlockedEntryCount,
      }).catch((err) => {
        logger.error('staff.timesheets emit time_entry.unlocked failed', { err })
      })
    }

    return { reportId: report.id, unlockedEntryCount }
  },
  buildLog: async ({ snapshots, ctx, input }) => {
    const before = (snapshots.before as { snapshot?: ReportSnapshot } | undefined)?.snapshot
    if (!before) return null
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const after = await loadReportSnapshot(em, before.id, staffSnapshotScopeFromSnapshot(before))
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.timesheets.reports.unlock', 'Unlock report entries'),
      resourceKind: STAFF_TIME_REPORT_RESOURCE_KIND,
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      changes: buildChanges(
        before as unknown as Record<string, unknown>,
        after as unknown as Record<string, unknown>,
        [...DIFFED_FIELDS],
      ),
      payload: { reason: input?.reason ?? null },
    }
  },
}

registerCommand(closeReportCommand)
registerCommand(unlockReportCommand)
