import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { SimulationLiveRecord, SimulationLiveRecordsPage } from '@open-mercato/shared/modules/insights/simulate'
import {
  simulationErrorSchema,
  simulationRecordsQuerySchema,
  simulationRecordsResponseSchema,
  simulationRunPathParamsSchema,
} from '../../../../data/validators'
import {
  SIMULATION_ACCESS_LOG_TYPES,
  SIMULATION_LIVE_RECORDS_DEFAULT_PAGE_SIZE,
  SIMULATION_LIVE_RECORDS_MAX_PAGE_SIZE,
  SIMULATION_VIEW_FEATURE,
} from '../../../../lib/simulation/constants'
import { createFeatureCheck } from '../../../../lib/simulation/context'
import { storedRunFeatures } from '../../../../lib/simulation/features'
import {
  SimulationAccessLogUnavailableError,
  createServiceResolver,
  runInReadOnlyTransaction,
  simulationScopeOrganizationIds,
  writeSimulationAccessLog,
} from '../../../../lib/simulation/inline'
import { sanitizeCoverage, sanitizeI18nKeys } from '../../../../lib/simulation/jobs'
import { getSimulationKind } from '../../../../lib/simulation/registry'
import {
  readSimulationRouteParam,
  resolveSimulationRouteContext,
  simulationError,
  simulationJson,
  simulationRouteFailure,
  simulationRunNotFound,
  type SimulationRouteParams,
} from '../../../../lib/simulation/routes'
import { toInternalHref } from '../../../../lib/simulation/samples'
import { findSimulationRun } from '../../../../lib/simulation/store'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: [SIMULATION_VIEW_FEATURE] },
}

const RECORD_TYPE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/

const MAX_TEXT = 300

function readText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed.slice(0, max) : null
}

function sanitizeRecord(record: SimulationLiveRecord): SimulationLiveRecord | null {
  const id = readText(record?.id, 200)
  const type = typeof record?.type === 'string' && RECORD_TYPE_PATTERN.test(record.type) ? record.type : null
  if (!id || !type) return null
  const groupKeys = Array.isArray(record.groupKeys)
    ? Array.from(new Set(record.groupKeys.map((key) => readText(key, 200)).filter((key): key is string => key !== null))).slice(0, 500)
    : []
  return {
    id,
    type,
    label: readText(record.label, MAX_TEXT),
    href: toInternalHref(record.href),
    groupKeys,
    counts: sanitizeCoverage(record.counts),
  }
}

function sanitizeGroupLabels(value: unknown): Record<string, string> {
  const labels: Record<string, string> = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return labels
  for (const [key, label] of Object.entries(value as Record<string, unknown>)) {
    const safeKey = readText(key, 200)
    const safeLabel = readText(label, MAX_TEXT)
    if (safeKey && safeLabel) labels[safeKey] = safeLabel
  }
  return labels
}

/**
 * The records the caller's own completed run concerns (S8: e.g. the users and API keys whose
 * permissions a role change would change), resolved LIVE on every read by the owning module under
 * the caller's current permissions and organization scope in a READ ONLY, statement-bounded
 * transaction — never stored. Same identical 404 as
 * the run itself; the kind's live-records features (e.g. `auth.users.list`) are required (403); a
 * kind with an access-log resource kind writes one row first (fail closed, 503).
 */
export async function GET(req: Request, routeContext: SimulationRouteParams) {
  let translate: TranslateFn | null = null
  try {
    const context = await resolveSimulationRouteContext(req)
    if (context instanceof NextResponse) return context
    translate = context.translate
    const params = simulationRunPathParamsSchema.safeParse({ id: await readSimulationRouteParam(routeContext, 'id') })
    if (!params.success) return simulationRunNotFound(context.translate)
    const query = simulationRecordsQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!query.success) return simulationError(context.translate, 'invalid_request', 400)
    const page = query.data.page ?? 1
    const pageSize = Math.min(query.data.pageSize ?? SIMULATION_LIVE_RECORDS_DEFAULT_PAGE_SIZE, SIMULATION_LIVE_RECORDS_MAX_PAGE_SIZE)
    const em = (context.container.resolve('em') as EntityManager).fork()
    const run = await findSimulationRun(em, { scope: context.scope, runId: params.data.id.toLowerCase(), requesterUserId: context.userId })
    const kind = run ? getSimulationKind(run.kind) : null
    if (!run || !kind) return simulationRunNotFound(context.translate)
    const hasFeatures = createFeatureCheck(context.container, context.userId, context.scope)
    if (!(await hasFeatures(storedRunFeatures(kind.definition, run.inputJson)))) return simulationRunNotFound(context.translate)
    const liveRecords = kind.definition.liveRecords
    const parsed = kind.definition.inputSchema.safeParse(run.inputJson)
    if (!liveRecords || !parsed.success) return simulationRunNotFound(context.translate)
    if (run.status !== 'completed') return simulationError(context.translate, 'run_not_completed', 409)
    if (!(await hasFeatures(liveRecords.requiredFeatures))) {
      return simulationError(context.translate, 'forbidden', 403, { requiredFeatures: [...liveRecords.requiredFeatures] })
    }
    const resolve = createServiceResolver(context.container)
    if (kind.definition.accessLogResourceKind) {
      try {
        await writeSimulationAccessLog(resolve, {
          scope: context.scope,
          actorUserId: context.userId,
          resourceKind: kind.definition.accessLogResourceKind,
          resourceId: run.artifactId ?? run.id,
          accessType: SIMULATION_ACCESS_LOG_TYPES.records,
          context: { kind: run.kind, runId: run.id, page, pageSize },
        })
      } catch (error) {
        if (error instanceof SimulationAccessLogUnavailableError) return simulationError(context.translate, 'access_log_unavailable', 503)
        throw error
      }
    }
    const organizationIds = simulationScopeOrganizationIds(context.commandContext.organizationScope, context.scope.organizationId)
    const rootEm = context.container.resolve('em') as EntityManager
    const listed: SimulationLiveRecordsPage = await runInReadOnlyTransaction(rootEm, (trx) => liveRecords.list(parsed.data, {
      em: trx,
      scope: context.scope,
      viewerUserId: context.userId,
      artifactId: run.artifactId ?? null,
      organizationIds,
      page,
      pageSize,
      hasFeatures,
      resolve,
    }))
    const items = (Array.isArray(listed?.items) ? listed.items : [])
      .slice(0, pageSize)
      .map(sanitizeRecord)
      .filter((record): record is SimulationLiveRecord => record !== null)
    const total = typeof listed?.total === 'number' && Number.isFinite(listed.total) && listed.total >= 0 ? Math.floor(listed.total) : items.length
    return simulationJson({
      ok: true,
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      notes: sanitizeI18nKeys(listed?.notes),
      groupLabels: sanitizeGroupLabels(listed?.groupLabels),
    })
  } catch (error) {
    return simulationRouteFailure(error, 'simulations.records', translate)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Insights',
  summary: 'Live records of a change simulation',
  pathParams: simulationRunPathParamsSchema,
  methods: {
    GET: {
      summary: 'List the records one of my completed simulations concerns',
      description: 'Resolved live by the owning module on every read, under the caller\'s current permissions and organization scope, and never stored (role permission preview: the users — and with `api_keys.view` the API keys — whose effective features the proposed role ACL would change; super administrators never appear). Needs the kind\'s live-records features (`auth.users.list` for the permission preview). Writes an access-log row first when the kind declares one. `pageSize` ≤ 100.',
      query: simulationRecordsQuerySchema,
      responses: [{ status: 200, description: 'One page of live records', schema: simulationRecordsResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid query or no organization selected (`organization_scope_required`)', schema: simulationErrorSchema },
        { status: 401, description: 'Authentication required', schema: simulationErrorSchema },
        { status: 403, description: 'Missing `insights.simulator.view` or the kind\'s live-records features (`forbidden`)', schema: simulationErrorSchema },
        { status: 404, description: 'Run not found, or its kind lists no live records (identical body for every reason)', schema: simulationErrorSchema },
        { status: 409, description: 'The run is not completed (`run_not_completed`)', schema: simulationErrorSchema },
        { status: 503, description: 'The access log cannot be written (`access_log_unavailable`)', schema: simulationErrorSchema },
      ],
    },
  },
}
