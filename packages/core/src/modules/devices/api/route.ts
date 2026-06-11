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
import { UserDevice } from '../data/entities'
import {
  registerDeviceSchema,
  registerDeviceCommandSchema,
  type RegisterDeviceCommandInput,
} from '../data/validators'
import { resolveDeviceActorUserId } from './auth'
import { createDevicesCrudOpenApi, createPagedListResponseSchema } from './openapi'
import { deviceListSchema, deviceListFields, deviceListSortFieldMap, deviceListItemSchema } from './deviceList'
import { executeRegister, type DeviceMutationContext } from './deviceOps'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['devices.view'] },
  POST: { requireAuth: true, requireFeatures: ['devices.manage'] },
}

export const metadata = routeMetadata

const NO_MATCH_USER_ID = '00000000-0000-0000-0000-000000000000'

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: UserDevice,
    idField: 'id',
    // Devices are tenant-scoped; organization_id is nullable, so disable automatic org scoping.
    orgField: null,
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.devices.user_device },
  // Align the CRUD cache resource tag with the command's resourceKind ('devices.user_device') so
  // writes through commands/devices.ts invalidate this list cache. Without this, the factory falls
  // back to the ORM entity name and the cache is never busted (stale list under ENABLE_CRUD_API_CACHE).
  // The factory does not own the write methods here (custom POST + command bus), so no events are emitted.
  events: { module: 'devices', entity: 'user_device' },
  list: {
    schema: deviceListSchema,
    entityId: E.devices.user_device,
    // push_token is a secret and is never exposed via the list API.
    fields: deviceListFields,
    sortFieldMap: deviceListSortFieldMap,
    // Self-serve: always scoped to the acting user. Cross-user listing lives in api/admin/devices.
    buildFilters: async (query, ctx) => {
      const filters: Record<string, unknown> = {}
      const actorUserId = resolveDeviceActorUserId(ctx.auth)
      // Fail closed when there is no resolvable acting user (e.g. API keys).
      filters.user_id = { $eq: actorUserId ?? NO_MATCH_USER_ID }
      if (query.platform) filters.platform = { $eq: query.platform }
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

    const body = registerDeviceSchema.parse(await readJsonSafe(req, {}))
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const organizationId = scope?.selectedId ?? auth.orgId ?? null

    const commandInput = registerDeviceCommandSchema.parse({
      ...body,
      tenantId: auth.tenantId,
      organizationId,
      userId: actorUserId,
    } satisfies RegisterDeviceCommandInput)

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
    console.error('[devices.POST]', err)
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
  resourceName: 'Device',
  pluralName: 'Devices',
  querySchema: deviceListSchema,
  listResponseSchema: createPagedListResponseSchema(deviceListItemSchema),
  create: {
    schema: registerDeviceSchema,
    responseSchema: registerResponseSchema,
    description:
      'Registers (or idempotently upserts) the current user\'s device for the given deviceId. May include an initial push token.',
  },
})
