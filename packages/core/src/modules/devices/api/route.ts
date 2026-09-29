import { NextResponse } from 'next/server'
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { consumeAdvancedFilterState, mergeAdvancedFilterTree } from '@open-mercato/shared/lib/crud/advanced-filter-integration'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveLocaleFromAcceptLanguage } from '@open-mercato/shared/lib/i18n/locale'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { E } from '#generated/entities.ids.generated'
import { UserDevice } from '../data/entities'
import {
  registerDeviceSchema,
  registerDeviceCommandSchema,
  type RegisterDeviceCommandInput,
} from '../data/validators'
import { resolveDeviceActorUserId } from './auth'
import { createDevicesCrudOpenApi, createPagedListResponseSchema } from './openapi'
import {
  deviceListSchema,
  deviceListFields,
  deviceListSortFieldMap,
  deviceListItemSchema,
  transformDeviceListItem,
} from './deviceList'
import { executeRegister, type DeviceMutationContext } from './deviceOps'

const logger = createLogger('devices')

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
    // organization_id stays nullable, but scoping follows the standard org-scoped pattern (like every
    // other module): the factory auto-filters by the caller's organization scope. The query engine's
    // org scope is null-aware — callers whose scope includes null (or who have no org restriction) also
    // see null-org rows; a caller pinned to a specific org does not.
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.devices.user_device },
  // Align the CRUD cache resource tag with the command's resourceKind ('devices.user_device') so
  // writes through the device commands invalidate this list cache. Without this, the factory falls
  // back to the ORM entity name and the cache is never busted (stale list under ENABLE_CRUD_API_CACHE).
  // The factory does not own the write methods here (custom POST + command bus), so no events are emitted.
  events: { module: 'devices', entity: 'user_device' },
  list: {
    schema: deviceListSchema,
    entityId: E.devices.user_device,
    // push_token is a secret and is never exposed via the list API.
    fields: deviceListFields,
    sortFieldMap: deviceListSortFieldMap,
    // The query engine projects raw column names; expose them in camelCase like every other module.
    transformItem: transformDeviceListItem,
    // Exports are off for the self-serve list. The factory enables them for every list that does not
    // declare `export` (resolveAvailableExportFormats falls back to csv/json/xml/markdown), and its
    // full-export branch replaces the filters with `{}` instead of calling `buildFilters`
    // (`baseFilters = exportFullRequested ? {} : buildFilters(...)`). On this route `buildFilters` is
    // the only user-level boundary — automatic scoping covers tenant and organization, not the acting
    // user — so `?format=json&exportScope=full` would return every device in the caller's org scope.
    // With no available formats, `exportRequested` is never true and that branch is unreachable. Bulk
    // device data belongs to the admin tree (api/admin/devices), which gates cross-user listing.
    export: { enabled: false },
    // Self-serve: always scoped to the acting user. Cross-user listing lives in api/admin/devices.
    buildFilters: async (query, ctx) => {
      // Consume the client-supplied advanced filter here (this deletes every `filter[...]` key from
      // `query`) so the CRUD factory's own merge step becomes a no-op. That step is
      // `{ ...existingFilters, ...advancedWhere }` (advanced-filter-integration.ts), and condition
      // field names are never validated — `filter[conditions][0][field]=user_id` or `=$and` would
      // otherwise overwrite whatever key this route uses for its scope and widen the listing to other
      // users. `mergeAdvancedFilterTree` instead AND-combines under `$and: [routeFilters, treeWhere]`,
      // where the scope sits in its own array element and no client key can reach it. Same pattern as
      // customers/people, companies and deals.
      const advancedFilterTree = consumeAdvancedFilterState(query)
      const filters: Record<string, unknown> = {}
      const actorUserId = resolveDeviceActorUserId(ctx.auth)
      // Self-serve visibility is strictly the acting user's own devices; cross-user listing lives in
      // api/admin/devices. Fail closed when there is no resolvable acting user (e.g. API keys).
      filters.user_id = { $eq: actorUserId ?? NO_MATCH_USER_ID }
      if (query.platform) filters.platform = { $eq: query.platform }
      return mergeAdvancedFilterTree(filters, advancedFilterTree)
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

    // When the app doesn't send an explicit per-device locale, fall back to the request's
    // Accept-Language (the mobile client calls this with its own headers). Only on self-register —
    // PUT stays tri-state, and admin register uses the admin's browser headers, not the device's.
    const headerLocale = resolveLocaleFromAcceptLanguage(req.headers.get('accept-language'))

    const commandInput = registerDeviceCommandSchema.parse({
      ...body,
      locale: body.locale ?? headerLocale ?? undefined,
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
    logger.error('devices.POST failed', { err })
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
