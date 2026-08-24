import { NextResponse } from 'next/server'
import { resolveFeatureAccess } from '../../../lib/time-tracking/featureAccess'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { CrudHttpError, forbidden, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { emitStaffEvent } from '../../../events'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { buildTimeTrackingSettingsSchema } from '../../../lib/time-tracking/settingKeys'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { STAFF_TIME_TRACKING_RESOURCE_KINDS } from '../../guards'
import {
  readSearchParamsRecord,
  runTimesheetInterceptors,
} from '../_shared/withTimesheetInterceptors'
import {
  readTimeTrackingSettings,
  writeTimeTrackingSettings,
  type TimeTrackingSettings,
} from '../../../lib/time-tracking/settings'

const logger = createLogger('staff').child({ component: 'api/timesheets/settings' })

const VIEW_FEATURE = 'staff.timesheets.view'
const MANAGE_FEATURE = 'staff.timesheets.settings.manage'
const RESOURCE_KIND = STAFF_TIME_TRACKING_RESOURCE_KINDS.settings
const RESOURCE_ID = 'time_tracking'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: [VIEW_FEATURE] },
  PUT: { requireAuth: true, requireFeatures: [MANAGE_FEATURE] },
}

/**
 * EP-42 — derived from the setting-key registry, so a contributed key is published in
 * the OpenAPI response shape instead of being invisible to it. Rebuilt per read for the
 * same reason the request schema is: a key may be registered after this module loads.
 */
function settingsResponseSchema(): z.ZodTypeAny {
  return buildTimeTrackingSettingsSchema()
}

type RbacServiceLike = {
  getGrantedFeatures?: (
    userId: string,
    options: { tenantId: string | null; organizationId: string | null },
  ) => Promise<string[]>
}

type SettingsContext = {
  container: Awaited<ReturnType<typeof createRequestContainer>>
  tenantId: string
  organizationId: string | null
  actorId: string
  translate: (key: string, fallback?: string) => string
}

async function resolveSettingsContext(req: Request): Promise<SettingsContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('staff.errors.unauthorized', 'Unauthorized') })
  }
  const actorId =
    (typeof auth.sub === 'string' && auth.sub.trim().length > 0 && auth.sub) ||
    (typeof auth.userId === 'string' && auth.userId.trim().length > 0 && auth.userId) ||
    (typeof auth.keyId === 'string' && auth.keyId.trim().length > 0 && auth.keyId) ||
    'system'
  return {
    container,
    tenantId: auth.tenantId,
    organizationId: auth.orgId ?? null,
    actorId,
    translate,
  }
}

function resolveConfigService(context: SettingsContext): ModuleConfigService {
  return context.container.resolve('moduleConfigService') as ModuleConfigService
}

/**
 * Granted features power both the explicit manage check below and the feature
 * gating inside the mutation-guard registry. Returns null when RBAC cannot be
 * consulted, in which case the declarative `requireFeatures` guard in `metadata`
 * remains the authorization source.
 */
async function resolveGrantedFeatures(context: SettingsContext): Promise<string[] | null> {
  try {
    const rbac = context.container.resolve('rbacService') as RbacServiceLike | undefined
    if (!rbac?.getGrantedFeatures) return null
    return await rbac.getGrantedFeatures(context.actorId, {
      tenantId: context.tenantId,
      organizationId: context.organizationId,
    })
  } catch {
    return null
  }
}

async function GET(req: Request) {
  try {
    const context = await resolveSettingsContext(req)
    const interceptors = await runTimesheetInterceptors({
      request: req,
      method: 'GET',
      scope: {
        container: context.container,
        userId: context.actorId,
        tenantId: context.tenantId,
        organizationId: context.organizationId,
        tenantGlobal: true,
      },
      query: readSearchParamsRecord(req.url),
    })
    if (!interceptors.ok) return interceptors.response

    const settings = await readTimeTrackingSettings(resolveConfigService(context), {
      tenantId: context.tenantId,
    })
    return interceptors.session.respond(200, settings)
  } catch (err) {
    return errorResponse(err, 'staff.timesheets.settings.GET failed')
  }
}

async function PUT(req: Request) {
  try {
    const context = await resolveSettingsContext(req)
    const grantedFeatures = await resolveGrantedFeatures(context)
    // Checked unconditionally. The `grantedFeatures &&` this replaces turned the
    // check off whenever the grant read failed — harmless here only because the
    // route metadata happens to require the same feature, which is exactly the
    // shape that leaked rates on the report routes where no such backstop existed.
    if (!(await resolveFeatureAccess(context.container, context.actorId || null, [MANAGE_FEATURE], { tenantId: context.tenantId, organizationId: context.organizationId })).allowed) {
      throw forbidden(context.translate('staff.errors.forbidden', 'Forbidden'))
    }

    const interceptors = await runTimesheetInterceptors({
      request: req,
      method: 'PUT',
      scope: {
        container: context.container,
        userId: context.actorId,
        tenantId: context.tenantId,
        organizationId: context.organizationId,
        userFeatures: grantedFeatures,
        tenantGlobal: true,
      },
      body: await readJsonSafe<Record<string, unknown>>(req, {}),
    })
    if (!interceptors.ok) return interceptors.response
    const { session } = interceptors

    const settingsSchema = buildTimeTrackingSettingsSchema()
    const parsed = settingsSchema.parse(session.body)

    const guardResult = await runRouteMutationGuards({
      container: context.container,
      req,
      auth: {
        userId: context.actorId,
        tenantId: context.tenantId,
        organizationId: context.organizationId,
        userFeatures: grantedFeatures ?? undefined,
      },
      input: {
        resourceKind: RESOURCE_KIND,
        resourceId: RESOURCE_ID,
        operation: 'update',
        mutationPayload: parsed,
      },
    })
    if (!guardResult.ok) return guardResult.response

    const effective = guardResult.modifiedPayload
      ? settingsSchema.parse({ ...parsed, ...guardResult.modifiedPayload })
      : parsed

    const settings: TimeTrackingSettings = await writeTimeTrackingSettings(
      resolveConfigService(context),
      { tenantId: context.tenantId },
      effective,
    )

    await guardResult.runAfterSuccess()

    void emitStaffEvent('staff.timesheets.time_tracking.settings_updated', {
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      settings,
    }, { persistent: true }).catch((err) => {
      logger.error('staff.timesheets emit time_tracking.settings_updated failed', { err })
    })

    return session.respond(200, settings)
  } catch (err) {
    return errorResponse(err, 'staff.timesheets.settings.PUT failed')
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

const getDoc: OpenApiMethodDoc = {
  summary: 'Read time tracking settings',
  tags: ['Staff'],
  get responses() {
    return [
      { status: 200, description: 'Tenant time tracking settings', schema: settingsResponseSchema() },
      { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
    ]
  },
}

const putDoc: OpenApiMethodDoc = {
  summary: 'Update time tracking settings',
  tags: ['Staff'],
  get requestBody() {
    return { schema: buildTimeTrackingSettingsSchema() }
  },
  get responses() {
    return [
      { status: 200, description: 'Updated time tracking settings', schema: settingsResponseSchema() },
    ]
  },
  errors: [
    { status: 400, description: 'Invalid request body' },
    { status: 401, description: 'Unauthorized' },
    { status: 403, description: 'Missing staff.timesheets.settings.manage' },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'Time tracking module settings',
  methods: {
    GET: getDoc,
    PUT: putDoc,
  },
}

export { GET, PUT }
