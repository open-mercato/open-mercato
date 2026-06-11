import { NextResponse } from 'next/server'
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { E } from '#generated/entities.ids.generated'
import type { EntityManager } from '@mikro-orm/postgresql'
import { UserDevice } from '../../../data/entities'
import {
  registerDeviceAdminSchema,
  registerDeviceCommandSchema,
  type RegisterDeviceCommandInput,
} from '../../../data/validators'
import { isOrganizationReadAccessAllowed } from '@open-mercato/core/modules/directory/utils/organizationScopeGuard'
import { loadExistingDevice } from '../../../commands/devices'
import { resolveDeviceActorUserId } from '../../auth'
import { createDevicesCrudOpenApi, createPagedListResponseSchema } from '../../openapi'
import { deviceListSchema, deviceListFields, deviceListSortFieldMap, deviceListItemSchema } from '../../deviceList'
import { executeRegister, type DeviceMutationContext } from '../../deviceOps'

// Admin device administration: cross-user listing + register-on-behalf-of-user. Gated by devices.admin.
// Self-serve registration/listing stays on /api/devices (scoped to the acting user).
const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['devices.admin'] },
  POST: { requireAuth: true, requireFeatures: ['devices.admin'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: UserDevice,
    idField: 'id',
    orgField: null,
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.devices.user_device },
  // Same cache resource tag as the self route + commands, so any device write busts both list caches.
  events: { module: 'devices', entity: 'user_device' },
  list: {
    schema: deviceListSchema,
    entityId: E.devices.user_device,
    fields: deviceListFields,
    sortFieldMap: deviceListSortFieldMap,
    // Tenant-wide (tenant scope enforced by orm.tenantField); optional userId/platform narrowing.
    // `orgField: null` disables the factory's automatic org scoping (organization_id is nullable), so
    // apply the same `ctx.organizationIds` scope the factory derives: null = unrestricted (whole
    // tenant, including null-org devices), otherwise narrow to the caller's in-scope orgs (an empty
    // set denies all). This mirrors isOrganizationReadAccessAllowed used on the detail routes.
    buildFilters: async (query, ctx) => {
      const filters: Record<string, unknown> = {}
      if (query.userId) filters.user_id = { $eq: query.userId }
      if (query.platform) filters.platform = { $eq: query.platform }
      if (ctx.organizationIds !== null) filters.organization_id = { $in: ctx.organizationIds }
      return filters
    },
  },
})

export const GET = crud.GET

export async function POST(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const actorUserId = resolveDeviceActorUserId(auth)
    if (!auth || !auth.tenantId || !actorUserId) {
      return NextResponse.json({ error: translate('devices.errors.unauthorized', 'Unauthorized') }, { status: 401 })
    }

    const body = registerDeviceAdminSchema.parse(await readJsonSafe(req, {}))
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const organizationId = scope?.selectedId ?? auth.orgId ?? null

    // Register is an idempotent upsert that revives/updates any existing row for this tuple. Block it
    // when the target user already has a device in an organization the admin cannot access, so a
    // restricted admin can't move another org's device into their own scope.
    const em = container.resolve('em') as EntityManager
    const existing = await loadExistingDevice(em.fork(), {
      tenantId: auth.tenantId,
      userId: body.userId,
      deviceId: body.deviceId,
    })
    if (existing && !isOrganizationReadAccessAllowed({ scope, auth, organizationId: existing.organizationId ?? null })) {
      return NextResponse.json({ error: translate('devices.errors.forbidden', 'Access denied') }, { status: 403 })
    }

    const commandInput = registerDeviceCommandSchema.parse({
      ...body,
      tenantId: auth.tenantId,
      organizationId,
      userId: body.userId,
    } satisfies RegisterDeviceCommandInput)

    // actorUserId is the admin (for the mutation guard/audit); the device is owned by body.userId.
    const mctx: DeviceMutationContext = { container, auth, scope, organizationId, actorUserId, request: req }
    return await executeRegister(mctx, commandInput)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: translate('devices.errors.invalid_payload', 'Invalid device payload'), details: err.flatten() },
        { status: 400 },
      )
    }
    if (isCrudHttpError(err) && (err.body as { code?: string } | undefined)?.code === 'device_already_registered') {
      return NextResponse.json(
        { error: translate('devices.errors.already_registered', 'This device is already registered') },
        { status: 409 },
      )
    }
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('[devices.admin.POST]', err)
    return NextResponse.json(
      { error: translate('devices.errors.register_failed', 'Failed to register device') },
      { status: 500 },
    )
  }
}

const registerResponseSchema = z.object({
  id: z.string().uuid(),
  deviceId: z.string(),
  revived: z.boolean(),
})

export const openApi: OpenApiRouteDoc = createDevicesCrudOpenApi({
  resourceName: 'Device (admin)',
  pluralName: 'Devices (admin)',
  querySchema: deviceListSchema,
  listResponseSchema: createPagedListResponseSchema(deviceListItemSchema),
  create: {
    schema: registerDeviceAdminSchema,
    responseSchema: registerResponseSchema,
    description: 'Admin: register (idempotently upsert) a device on behalf of any user in the tenant.',
  },
})
