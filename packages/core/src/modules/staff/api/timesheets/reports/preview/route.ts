/**
 * `POST /api/staff/timesheets/reports/preview` — screen 13's live numbers.
 *
 * It persists nothing. It exists because the project pick-list has to show what
 * each project would contribute BEFORE a report row exists, and because the
 * already-reported panel (D-5) has to be answerable at configuration time — the
 * whole point of that panel is to be read before the report is generated, not
 * after.
 *
 * It is a POST because the input is a project selection plus a period, not a
 * URL-shaped filter. It is nonetheless a **read**: it runs no command, writes no
 * row and therefore wires no mutation guard, which would otherwise run
 * after-success callbacks for a mutation that never happened. Authorization is
 * `staff.timesheets.reports.view` plus the same `resolveProjectAccess`
 * narrowing every other timesheets route uses.
 *
 * Two refusals are deliberate and named:
 *
 *  - **`422 report_currency_conflict`** when the selected projects disagree on a
 *    currency (risk R2). The body lists the currencies and the offending
 *    projects, because "pick one currency" is unactionable otherwise.
 *  - **`422 report_project_not_found`** when a requested project is outside the
 *    caller's access. Dropping it silently would produce a smaller, plausible
 *    total that nobody could explain.
 */

import { resolveMoneyVisibility } from '../../../../lib/time-tracking/moneyVisibility'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { staffTimeReportPreviewSchema } from '../../../../data/validators'
import { resolveProjectAccess } from '../../../../lib/time-tracking/access'
import { readTimeTrackingSettings } from '../../../../lib/time-tracking/settings'
import { loadReportData } from '../../../../lib/timesheets-reports/loadReportData'
import {
  computeReportTotals,
  resolveEntryValues,
  resolveReportCurrency,
  sumAmounts,
  type ReportGroup,
  type ReportInputEntry,
} from '../../../../lib/timesheets-reports/reportTotals'

const logger = createLogger('staff').child({ component: 'api/timesheets/reports/preview' })

const VIEW_FEATURE = 'staff.timesheets.reports.view'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: [VIEW_FEATURE] },
}

type RbacServiceLike = {
  getGrantedFeatures?: (
    userId: string,
    options: { tenantId: string | null; organizationId: string | null },
  ) => Promise<string[]>
}

async function resolveGrantedFeatures(
  container: Awaited<ReturnType<typeof createRequestContainer>>,
  userId: string,
  tenantId: string,
  organizationId: string | null,
): Promise<string[] | null> {
  try {
    const rbac = container.resolve('rbacService') as RbacServiceLike | undefined
    if (!rbac?.getGrantedFeatures) return null
    return await rbac.getGrantedFeatures(userId, { tenantId, organizationId })
  } catch {
    return null
  }
}

export type PreviewProjectTotals = {
  id: string
  name: string
  hourlyRate: number | null
  currencyCode: string | null
  entryCount: number
  billableMinutes: number
  nonbillableMinutes: number
  amount: number | null
}

/**
 * Per-project figures for the pick-list. They depend only on (project, period)
 * and never on which other projects are ticked, so the screen can render every
 * candidate — including one with no entries, which stays listed but unticked and
 * greyed (screen 13 note 2) rather than disappearing.
 *
 * The amounts here go through the same `resolveEntryValues` the totals use, so a
 * row's figure and the grand total can never come from two different rules.
 */
export function summarizeProjectsForPreview(
  projects: readonly { id: string; name: string; hourlyRate: number | null; currencyCode: string | null }[],
  entries: readonly ReportInputEntry[],
  options: { includeAlreadyReported: boolean; excludeNonBillable: boolean; canSeeMoney: boolean },
): PreviewProjectTotals[] {
  const byProject = new Map<string, ReportInputEntry[]>()
  for (const entry of entries) {
    const bucket = byProject.get(entry.timeProjectId)
    if (bucket) bucket.push(entry)
    else byProject.set(entry.timeProjectId, [entry])
  }

  return projects.map((project) => {
    const projectEntries = byProject.get(project.id) ?? []
    let billableMinutes = 0
    let nonbillableMinutes = 0
    const amounts: Array<number | null> = []
    let entryCount = 0

    for (const entry of projectEntries) {
      if (entry.frozen && !options.includeAlreadyReported) continue
      const values = resolveEntryValues(entry, project)
      if (!values.isBillable) {
        if (options.excludeNonBillable) continue
        nonbillableMinutes += values.minutes
        entryCount += 1
        continue
      }
      billableMinutes += values.minutes
      amounts.push(values.amount)
      entryCount += 1
    }

    return {
      id: project.id,
      name: project.name,
      hourlyRate: options.canSeeMoney ? project.hourlyRate : null,
      currencyCode: project.currencyCode,
      entryCount,
      billableMinutes,
      nonbillableMinutes,
      amount: options.canSeeMoney ? sumAmounts(amounts) : null,
    }
  })
}

/** Money is absent from the payload — not zeroed — for a caller without `rates.view`. */
function stripMoney(groups: ReportGroup[]): ReportGroup[] {
  return groups.map((group) => ({
    ...group,
    rate: null,
    amount: 0,
    lines: group.lines.map(function strip(line): ReportGroup['lines'][number] {
      return { ...line, rate: null, amount: 0, children: line.children.map(strip) }
    }),
  }))
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

    const grantedFeatures = await resolveGrantedFeatures(container, auth.sub ?? '', tenantId, organizationId)
    // Fail-closed, and asked of the RBAC service rather than matched against the
    // grant array: the previous `grantedFeatures === null || …` handed rates and
    // costs to any report viewer whenever that array could not be read, and this
    // route requires only `reports.view`.
    const canSeeMoney = await resolveMoneyVisibility(container, auth.sub ?? null, {
      tenantId,
      organizationId,
    })

    const body = await req.json().catch(() => ({}))
    const parsed = staffTimeReportPreviewSchema.parse(body)

    const em = (container.resolve('em') as EntityManager).fork()
    const access = await resolveProjectAccess({
      em,
      userId: auth.sub ?? null,
      tenantId,
      organizationId,
      userFeatures: grantedFeatures ?? [],
      assignmentGraceDays: await readAssignmentGraceDays(container, tenantId),
    })

    const requestedIds = Array.from(new Set(parsed.timeProjectIds))
    const deniedIds = access.canManageAll
      ? []
      : requestedIds.filter((id) => !access.projectIds.includes(id))
    if (deniedIds.length > 0) {
      const message = translate(
        'staff.time_tracking.reports.errors.projectNotFound',
        'Some of the selected projects are not available.',
      )
      throw new CrudHttpError(422, {
        code: 'report_project_not_found',
        error: message,
        fieldErrors: { timeProjectIds: message },
        missingProjectIds: deniedIds,
      })
    }

    const data = await loadReportData({
      em,
      scope: { tenantId, organizationId },
      timeProjectIds: requestedIds,
      periodFrom: parsed.periodFrom,
      periodTo: parsed.periodTo,
    })

    if (data.projects.length !== requestedIds.length) {
      const found = new Set(data.projects.map((project) => project.id))
      const message = translate(
        'staff.time_tracking.reports.errors.projectNotFound',
        'Some of the selected projects are not available.',
      )
      throw new CrudHttpError(422, {
        code: 'report_project_not_found',
        error: message,
        fieldErrors: { timeProjectIds: message },
        missingProjectIds: requestedIds.filter((id) => !found.has(id)),
      })
    }

    // Risk R2, asserted before a single amount is produced.
    const currency = resolveReportCurrency(
      data.projects.map((project) => ({
        id: project.id,
        name: project.name,
        currencyCode: project.currencyCode,
      })),
    )
    if (!currency.ok) {
      const message = translate(
        'staff.time_tracking.reports.errors.currencyConflict',
        'A report always covers one currency. Selected projects use {currencies}.',
      ).replace('{currencies}', currency.currencies.join(', '))
      throw new CrudHttpError(422, {
        code: 'report_currency_conflict',
        error: message,
        fieldErrors: { timeProjectIds: message },
        currencies: currency.currencies,
        offenders: currency.offenders.map((project) => ({
          id: project.id,
          name: project.name,
          currencyCode: project.currencyCode ?? null,
        })),
      })
    }

    const totals = computeReportTotals({
      entries: data.entries,
      projects: data.projects,
      directory: data.directory,
      options: {
        grouping: parsed.grouping,
        nonbillableMode: parsed.nonbillableMode,
        includeAlreadyReported: parsed.includeAlreadyReported,
      },
      labels: reportLabels(translate),
    })

    const configService = safeConfigService(container)
    const settings = configService
      ? await readTimeTrackingSettings(configService, { tenantId })
      : null

    return NextResponse.json({
      currencyCode: currency.currencyCode,
      grouping: parsed.grouping,
      nonbillableMode: parsed.nonbillableMode,
      includeAlreadyReported: parsed.includeAlreadyReported,
      showRates: parsed.showRates && canSeeMoney,
      projects: summarizeProjectsForPreview(data.projects, data.entries, {
        includeAlreadyReported: parsed.includeAlreadyReported,
        excludeNonBillable: parsed.nonbillableMode === 'exclude',
        canSeeMoney,
      }),
      groups: canSeeMoney ? totals.groups : stripMoney(totals.groups),
      totals: {
        entryCount: totals.entryCount,
        billableMinutes: totals.billableMinutes,
        nonbillableMinutes: totals.nonbillableMinutes,
        totalAmount: canSeeMoney ? totals.totalAmount : null,
      },
      alreadyReportedCount: totals.alreadyReportedCount,
      alreadyReportedMinutes: totals.alreadyReportedMinutes,
      alreadyReportedIn: totals.alreadyReportedIn,
      rounding: {
        unitMinutes: settings?.rounding.unitMinutes ?? 0,
        direction: settings?.rounding.direction ?? 'up',
      },
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
    logger.error('staff.timesheets.reports.preview failed', { err })
    return NextResponse.json(
      { error: translate('staff.errors.internal', 'Internal server error') },
      { status: 500 },
    )
  }
}

type ContainerLike = { resolve: (name: string) => unknown }

function safeConfigService(container: ContainerLike): ModuleConfigService | null {
  try {
    return container.resolve('moduleConfigService') as ModuleConfigService
  } catch {
    return null
  }
}

async function readAssignmentGraceDays(container: ContainerLike, tenantId: string): Promise<number | null> {
  const configService = safeConfigService(container)
  if (!configService) return null
  try {
    const settings = await readTimeTrackingSettings(configService, { tenantId })
    return settings.access.assignmentGraceDays
  } catch {
    return null
  }
}

export function reportLabels(translate: (key: string, fallback: string) => string) {
  return {
    unassignedTask: translate('staff.time_tracking.reports.sheet.noTask', 'No task'),
    unassignedPerson: translate('staff.time_tracking.reports.sheet.noPerson', 'Unassigned'),
    nonbillableGroup: translate('staff.time_tracking.reports.sheet.nonbillable', 'Non-billable time'),
  }
}

const previewLineSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    key: z.string(),
    label: z.string(),
    minutes: z.number().int(),
    rate: z.number().nullable(),
    amount: z.number(),
    entryCount: z.number().int(),
    hasOverride: z.boolean(),
    children: z.array(previewLineSchema),
  }),
)

const previewResponseSchema = z.object({
  currencyCode: z.string().nullable(),
  grouping: z.enum(['project_task', 'project_person', 'project_day']),
  nonbillableMode: z.enum(['separate', 'exclude']),
  includeAlreadyReported: z.boolean(),
  showRates: z.boolean(),
  projects: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      hourlyRate: z.number().nullable(),
      currencyCode: z.string().nullable(),
      entryCount: z.number().int(),
      billableMinutes: z.number().int(),
      nonbillableMinutes: z.number().int(),
      amount: z.number().nullable(),
    }),
  ),
  groups: z.array(
    z.object({
      key: z.string(),
      kind: z.enum(['project', 'nonbillable']),
      label: z.string(),
      rate: z.number().nullable(),
      minutes: z.number().int(),
      amount: z.number(),
      entryCount: z.number().int(),
      lines: z.array(previewLineSchema),
    }),
  ),
  totals: z.object({
    entryCount: z.number().int(),
    billableMinutes: z.number().int(),
    nonbillableMinutes: z.number().int(),
    totalAmount: z.number().nullable(),
  }),
  alreadyReportedCount: z.number().int(),
  alreadyReportedMinutes: z.number().int(),
  alreadyReportedIn: z.array(
    z.object({
      reportId: z.string().uuid(),
      reference: z.string().nullable(),
      title: z.string().nullable(),
      entryCount: z.number().int(),
      minutes: z.number().int(),
    }),
  ),
  rounding: z.object({ unitMinutes: z.number().int(), direction: z.string() }),
})

const currencyConflictSchema = z.object({
  code: z.literal('report_currency_conflict'),
  error: z.string(),
  currencies: z.array(z.string()),
  offenders: z.array(
    z.object({ id: z.string().uuid(), name: z.string(), currencyCode: z.string().nullable() }),
  ),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'Preview a customer report',
  methods: {
    POST: {
      summary: 'Preview a customer report',
      description:
        'Computes report totals for a project selection and period WITHOUT persisting anything. Powers the live per-project numbers and the range summary of the report config screen. Money is rounded at the entry and summed upward (D-7), so the grand total does not change when the grouping changes. Entries already frozen in a closed report are excluded unless `includeAlreadyReported` is set, and are reported as `alreadyReportedCount` / `alreadyReportedMinutes` / `alreadyReportedIn` either way (D-5). Amounts and rates are omitted for a caller without staff.timesheets.rates.view.',
      requestBody: {
        contentType: 'application/json',
        schema: staffTimeReportPreviewSchema,
      },
      responses: [{ status: 200, description: 'Computed totals', schema: previewResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid body or missing scope' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing staff.timesheets.reports.view' },
        {
          status: 422,
          description: 'Selected projects disagree on a currency, or one is not accessible',
          schema: currencyConflictSchema,
        },
      ],
    },
  },
}
