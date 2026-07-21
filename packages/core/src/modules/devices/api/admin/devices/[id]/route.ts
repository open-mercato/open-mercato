import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { UserDevice } from '../../../../data/entities'
import { updateDeviceSchema } from '../../../../data/validators'
import { isOrganizationReadAccessAllowed } from '@open-mercato/core/modules/directory/utils/organizationScopeGuard'
import { resolveDeviceActorUserId } from '../../../auth'
import { executeUpdate, executeDeactivate, type DeviceMutationContext } from '../../../deviceOps'

const logger = createLogger('devices')

// Admin: read/update/deactivate ANY device in the tenant. Gated by devices.admin (no owner check).
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['devices.admin'] },
  PUT: { requireAuth: true, requireFeatures: ['devices.admin'] },
  DELETE: { requireAuth: true, requireFeatures: ['devices.admin'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

async function loadDevice(
  container: Awaited<ReturnType<typeof createRequestContainer>>,
  id: string,
  tenantId: string,
): Promise<UserDevice | null> {
  const em = container.resolve('em') as EntityManager
  // push_token is encrypted at rest; the org is not known until the row loads, so pass tenant only —
  // the helper prefers each record's own tenant/org and treats this scope as a fallback.
  return findOneWithDecryption(em, UserDevice, { id, tenantId, deletedAt: null }, undefined, { tenantId })
}

// push_token is a secret and is never returned.
function serializeDevice(device: UserDevice) {
  return {
    id: device.id,
    user_id: device.userId,
    device_id: device.deviceId,
    platform: device.platform,
    client_app_version: device.clientAppVersion ?? null,
    os_version: device.osVersion ?? null,
    push_provider: device.pushProvider ?? null,
    push_token_updated_at: device.pushTokenUpdatedAt ? device.pushTokenUpdatedAt.toISOString() : null,
    last_seen_at: device.lastSeenAt ? device.lastSeenAt.toISOString() : null,
    created_at: device.createdAt ? device.createdAt.toISOString() : null,
    updated_at: device.updatedAt ? device.updatedAt.toISOString() : null,
  }
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const { translate } = await resolveTranslations()
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const actorUserId = resolveDeviceActorUserId(auth)
    if (!auth || !auth.tenantId || !actorUserId) {
      return NextResponse.json({ error: translate('devices.errors.unauthorized', 'Unauthorized') }, { status: 401 })
    }
    const parsedParams = paramsSchema.safeParse({ id: params.id })
    if (!parsedParams.success) {
      return NextResponse.json({ error: translate('devices.errors.invalid_id', 'Invalid device id') }, { status: 400 })
    }
    const device = await loadDevice(container, parsedParams.data.id, auth.tenantId)
    if (!device) {
      return NextResponse.json({ error: translate('devices.errors.not_found', 'Device not found') }, { status: 404 })
    }
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    if (!isOrganizationReadAccessAllowed({ scope, auth, organizationId: device.organizationId ?? null })) {
      return NextResponse.json({ error: translate('devices.errors.forbidden', 'Access denied') }, { status: 403 })
    }
    return NextResponse.json({ item: serializeDevice(device) })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    logger.error('devices.admin.GET failed', { err })
    return NextResponse.json({ error: translate('devices.errors.load_failed', 'Failed to load device') }, { status: 500 })
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const { translate } = await resolveTranslations()
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const actorUserId = resolveDeviceActorUserId(auth)
    if (!auth || !auth.tenantId || !actorUserId) {
      return NextResponse.json({ error: translate('devices.errors.unauthorized', 'Unauthorized') }, { status: 401 })
    }
    const parsedParams = paramsSchema.safeParse({ id: params.id })
    if (!parsedParams.success) {
      return NextResponse.json({ error: translate('devices.errors.invalid_id', 'Invalid device id') }, { status: 400 })
    }

    const body = updateDeviceSchema.parse(await readJsonSafe(req, {}))
    const device = await loadDevice(container, parsedParams.data.id, auth.tenantId)
    if (!device) {
      return NextResponse.json({ error: translate('devices.errors.not_found', 'Device not found') }, { status: 404 })
    }

    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    if (!isOrganizationReadAccessAllowed({ scope, auth, organizationId: device.organizationId ?? null })) {
      return NextResponse.json({ error: translate('devices.errors.forbidden', 'Access denied') }, { status: 403 })
    }
    const mctx: DeviceMutationContext = {
      container,
      auth,
      scope,
      organizationId: device.organizationId ?? null,
      actorUserId,
      request: req,
    }
    return await executeUpdate(mctx, device, body)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: translate('devices.errors.invalid_payload', 'Invalid device payload'), details: err.flatten() },
        { status: 400 },
      )
    }
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    logger.error('devices.admin.PUT failed', { err })
    return NextResponse.json({ error: translate('devices.errors.update_failed', 'Failed to update device') }, { status: 500 })
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const { translate } = await resolveTranslations()
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const actorUserId = resolveDeviceActorUserId(auth)
    if (!auth || !auth.tenantId || !actorUserId) {
      return NextResponse.json({ error: translate('devices.errors.unauthorized', 'Unauthorized') }, { status: 401 })
    }
    const parsedParams = paramsSchema.safeParse({ id: params.id })
    if (!parsedParams.success) {
      return NextResponse.json({ error: translate('devices.errors.invalid_id', 'Invalid device id') }, { status: 400 })
    }

    const device = await loadDevice(container, parsedParams.data.id, auth.tenantId)
    if (!device) {
      return NextResponse.json({ error: translate('devices.errors.not_found', 'Device not found') }, { status: 404 })
    }

    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    if (!isOrganizationReadAccessAllowed({ scope, auth, organizationId: device.organizationId ?? null })) {
      return NextResponse.json({ error: translate('devices.errors.forbidden', 'Access denied') }, { status: 403 })
    }
    const mctx: DeviceMutationContext = {
      container,
      auth,
      scope,
      organizationId: device.organizationId ?? null,
      actorUserId,
      request: req,
    }
    return await executeDeactivate(mctx, device)
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    logger.error('devices.admin.DELETE failed', { err })
    return NextResponse.json({ error: translate('devices.errors.delete_failed', 'Failed to delete device') }, { status: 500 })
  }
}

const okResponseSchema = z.object({ ok: z.literal(true), id: z.string().uuid().optional() })
const errorResponseSchema = z.object({ error: z.string() })
const detailResponseSchema = z.object({
  item: z.object({
    id: z.string().uuid(),
    user_id: z.string().uuid(),
    device_id: z.string(),
    platform: z.enum(['ios', 'android', 'web']),
    client_app_version: z.string().nullable(),
    os_version: z.string().nullable(),
    push_provider: z.string().nullable(),
    push_token_updated_at: z.string().nullable(),
    last_seen_at: z.string().nullable(),
    created_at: z.string().nullable(),
    updated_at: z.string().nullable(),
  }),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Devices (admin)',
  summary: 'Admin: read, update or deactivate any device in the tenant',
  methods: {
    GET: {
      summary: 'Get any device',
      description: 'Admin: fetch a single device by id (push_token is never returned).',
      responses: [{ status: 200, description: 'Device', schema: detailResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid id', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 403, description: 'Missing devices.admin', schema: errorResponseSchema },
        { status: 404, description: 'Device not found', schema: errorResponseSchema },
      ],
    },
    PUT: {
      summary: 'Update any device',
      description: 'Admin: update last-seen, app/OS metadata, and push token for any device. Set pushToken to null to clear it.',
      requestBody: { schema: updateDeviceSchema },
      responses: [{ status: 200, description: 'Device updated', schema: okResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid payload or id', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 403, description: 'Missing devices.admin', schema: errorResponseSchema },
        { status: 404, description: 'Device not found', schema: errorResponseSchema },
      ],
    },
    DELETE: {
      summary: 'Deactivate any device',
      description: 'Admin: soft-delete any device in the tenant.',
      responses: [{ status: 200, description: 'Device deactivated', schema: okResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid id', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 403, description: 'Missing devices.admin', schema: errorResponseSchema },
        { status: 404, description: 'Device not found', schema: errorResponseSchema },
      ],
    },
  },
}
