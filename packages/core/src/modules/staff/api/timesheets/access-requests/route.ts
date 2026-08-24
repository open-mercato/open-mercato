import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { StaffTeamMember, StaffTimeProject } from '../../../data/entities'
import { emitStaffEvent } from '../../../events'
import { STAFF_TIME_TRACKING_RESOURCE_KINDS } from '../../guards'

const logger = createLogger('staff').child({ component: 'api/timesheets/access-requests' })

const VIEW_FEATURE = 'staff.timesheets.view'
const RESOURCE_KIND = STAFF_TIME_TRACKING_RESOURCE_KINDS.accessRequest

/**
 * Spec D-6: one pending request per user per project (or per user for the
 * general, project-less request) per 24h. The window is held in the shared
 * cache rather than a table — the notification itself carries a `groupKey`, so
 * even if the cache is cold the manager still sees a single refreshed
 * notification instead of a duplicate row.
 */
export const ACCESS_REQUEST_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000

const GENERAL_REQUEST_SCOPE = 'general'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: [VIEW_FEATURE] },
}

const accessRequestSchema = z.object({
  timeProjectId: z.string().uuid().nullish(),
})

const accessRequestResponseSchema = z.object({
  ok: z.literal(true),
  deduplicated: z.boolean(),
})

type RbacServiceLike = {
  getGrantedFeatures?: (
    userId: string,
    options: { tenantId: string | null; organizationId: string | null },
  ) => Promise<string[]>
}

type DedupeCacheLike = {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown, options?: { ttl?: number }) => Promise<void>
}

type AccessRequestContext = {
  container: Awaited<ReturnType<typeof createRequestContainer>>
  em: EntityManager
  tenantId: string
  organizationId: string
  requesterUserId: string
  requesterEmail: string | null
  translate: (key: string, fallback?: string) => string
}

async function resolveAccessRequestContext(req: Request): Promise<AccessRequestContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('staff.errors.unauthorized', 'Unauthorized') })
  }
  const requesterUserId =
    (typeof auth.sub === 'string' && auth.sub.trim().length > 0 && auth.sub) ||
    (typeof auth.userId === 'string' && auth.userId.trim().length > 0 && auth.userId) ||
    null
  if (!requesterUserId) {
    throw new CrudHttpError(401, { error: translate('staff.errors.unauthorized', 'Unauthorized') })
  }
  if (!auth.orgId) {
    throw new CrudHttpError(400, {
      error: translate('staff.errors.missingScope', 'Missing tenant or organization scope.'),
    })
  }
  return {
    container,
    em: (container.resolve('em') as EntityManager).fork(),
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    requesterUserId,
    requesterEmail: typeof auth.email === 'string' && auth.email.trim().length > 0 ? auth.email : null,
    translate,
  }
}

/**
 * Granted features feed the mutation-guard registry so feature-gated guards run
 * for the caller. Returns null when RBAC cannot be consulted, in which case the
 * declarative `requireFeatures` guard in `metadata` remains the authorization
 * source.
 */
async function resolveGrantedFeatures(context: AccessRequestContext): Promise<string[] | null> {
  try {
    const rbac = context.container.resolve('rbacService') as RbacServiceLike | undefined
    if (!rbac?.getGrantedFeatures) return null
    return await rbac.getGrantedFeatures(context.requesterUserId, {
      tenantId: context.tenantId,
      organizationId: context.organizationId,
    })
  } catch {
    return null
  }
}

function resolveDedupeCache(context: AccessRequestContext): DedupeCacheLike | null {
  try {
    const cache = context.container.resolve('cache') as Partial<DedupeCacheLike> | undefined
    if (typeof cache?.get !== 'function' || typeof cache?.set !== 'function') return null
    return cache as DedupeCacheLike
  } catch {
    return null
  }
}

export function buildAccessRequestDedupeKey(input: {
  tenantId: string
  organizationId: string
  requesterUserId: string
  timeProjectId: string | null
}): string {
  const scope = input.timeProjectId ?? GENERAL_REQUEST_SCOPE
  return `staff:timesheets:access-request:${input.tenantId}:${input.organizationId}:${input.requesterUserId}:${scope}`
}

/**
 * Resolves the requested project inside the caller's scope. A project the
 * caller's tenant/organization does not own resolves to `null` and the request
 * degrades to a general one — the response never differentiates, so the route
 * cannot be used to probe which project ids exist (screen 17 note 1).
 */
async function resolveRequestedProject(
  context: AccessRequestContext,
  timeProjectId: string | null,
): Promise<{ id: string; name: string } | null> {
  if (!timeProjectId) return null
  const scope = { tenantId: context.tenantId, organizationId: context.organizationId }
  const project = await findOneWithDecryption(
    context.em,
    StaffTimeProject,
    { id: timeProjectId, tenantId: context.tenantId, organizationId: context.organizationId, deletedAt: null },
    {},
    scope,
  )
  if (!project) return null
  return { id: project.id, name: project.name }
}

async function resolveRequesterName(context: AccessRequestContext): Promise<string> {
  const scope = { tenantId: context.tenantId, organizationId: context.organizationId }
  const staffMember = await findOneWithDecryption(
    context.em,
    StaffTeamMember,
    {
      userId: context.requesterUserId,
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      deletedAt: null,
    },
    {},
    scope,
  )
  const displayName = staffMember?.displayName
  if (typeof displayName === 'string' && displayName.trim().length > 0) return displayName
  return context.requesterEmail ?? context.requesterUserId
}

async function POST(req: Request) {
  try {
    const context = await resolveAccessRequestContext(req)
    const body = await req.json().catch(() => ({}))
    const parsed = accessRequestSchema.parse(body ?? {})
    const grantedFeatures = await resolveGrantedFeatures(context)

    const guardResult = await runRouteMutationGuards({
      container: context.container,
      req,
      auth: {
        userId: context.requesterUserId,
        tenantId: context.tenantId,
        organizationId: context.organizationId,
        userFeatures: grantedFeatures ?? undefined,
      },
      input: {
        resourceKind: RESOURCE_KIND,
        resourceId: parsed.timeProjectId ?? GENERAL_REQUEST_SCOPE,
        operation: 'create',
        mutationPayload: { timeProjectId: parsed.timeProjectId ?? null },
      },
    })
    if (!guardResult.ok) return guardResult.response

    const effective = guardResult.modifiedPayload
      ? accessRequestSchema.parse({ ...parsed, ...guardResult.modifiedPayload })
      : parsed

    const project = await resolveRequestedProject(context, effective.timeProjectId ?? null)
    const dedupeKey = buildAccessRequestDedupeKey({
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      requesterUserId: context.requesterUserId,
      timeProjectId: project?.id ?? null,
    })

    const cache = resolveDedupeCache(context)
    if (cache) {
      const pending = await cache.get(dedupeKey).catch(() => null)
      if (pending != null) {
        await guardResult.runAfterSuccess()
        return NextResponse.json({ ok: true, deduplicated: true })
      }
    }

    const requesterName = await resolveRequesterName(context)
    await emitStaffEvent('staff.timesheets.project_access.requested', {
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      requesterUserId: context.requesterUserId,
      requesterName,
      timeProjectId: project?.id ?? null,
      timeProjectName: project?.name ?? null,
      requestedAt: new Date().toISOString(),
    })

    if (cache) {
      await cache
        .set(dedupeKey, { requestedAt: Date.now() }, { ttl: ACCESS_REQUEST_DEDUPE_WINDOW_MS })
        .catch((err: unknown) => {
          logger.warn('Failed to record the access-request dedupe window', { err })
        })
    }

    await guardResult.runAfterSuccess()

    return NextResponse.json({ ok: true, deduplicated: false })
  } catch (err) {
    return errorResponse(err, 'staff.timesheets.access-requests.POST failed')
  }
}

async function errorResponse(err: unknown, message: string) {
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
  logger.error(message, { err })
  return NextResponse.json(
    { error: translate('staff.errors.internal', 'Internal server error') },
    { status: 500 },
  )
}

const postDoc: OpenApiMethodDoc = {
  summary: 'Request time tracking project access',
  description:
    'Notifies every holder of staff.timesheets.projects.manage in the caller scope that a team member asked for project access. Omitting timeProjectId sends a general request from the no-assignments empty state.',
  tags: ['Staff'],
  requestBody: { schema: accessRequestSchema },
  responses: [
    {
      status: 200,
      description: 'Access request accepted (deduplicated when an identical request is still pending)',
      schema: accessRequestResponseSchema,
    },
  ],
  errors: [
    { status: 400, description: 'Invalid request body or missing organization scope' },
    { status: 401, description: 'Unauthorized' },
    { status: 403, description: 'Missing staff.timesheets.view' },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'Time tracking project access requests',
  methods: {
    POST: postDoc,
  },
}

export { POST }
