import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { UserDevice } from '../../data/entities'
import { updateDeviceSchema } from '../../data/validators'
import { resolveDeviceActorUserId } from '../auth'
import { executeUpdate, executeDeactivate, type DeviceMutationContext } from '../deviceOps'

const logger = createLogger('devices')

// Self-serve: the caller may only mutate their OWN device. Cross-user device administration lives in
// api/admin/devices/[id] (gated by devices.admin).
export const metadata = {
  PUT: { requireAuth: true, requireFeatures: ['devices.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['devices.manage'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

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
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    // Self devices are scoped to the caller's active organization, mirroring the list route and the
    // user-owned-resource convention (e.g. progress jobs): a device outside the current org context
    // reads as not-found. When there is no active org, scope by tenant only.
    const currentOrganizationId = scope?.selectedId ?? auth.orgId ?? null
    const em = container.resolve('em') as EntityManager
    const device = await findOneWithDecryption(
      em,
      UserDevice,
      {
        id: parsedParams.data.id,
        tenantId: auth.tenantId,
        ...(currentOrganizationId ? { organizationId: currentOrganizationId } : {}),
        deletedAt: null,
      },
      undefined,
      { tenantId: auth.tenantId, organizationId: currentOrganizationId },
    )
    if (!device) {
      return NextResponse.json({ error: translate('devices.errors.not_found', 'Device not found') }, { status: 404 })
    }
    if (device.userId !== actorUserId) {
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
    logger.error('devices.PUT failed', { err })
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

    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    // Same active-org scoping as PUT/the list route: a device outside the current org reads as not-found.
    const currentOrganizationId = scope?.selectedId ?? auth.orgId ?? null
    const em = container.resolve('em') as EntityManager
    const device = await findOneWithDecryption(
      em,
      UserDevice,
      {
        id: parsedParams.data.id,
        tenantId: auth.tenantId,
        ...(currentOrganizationId ? { organizationId: currentOrganizationId } : {}),
        deletedAt: null,
      },
      undefined,
      { tenantId: auth.tenantId, organizationId: currentOrganizationId },
    )
    if (!device) {
      return NextResponse.json({ error: translate('devices.errors.not_found', 'Device not found') }, { status: 404 })
    }
    if (device.userId !== actorUserId) {
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
    logger.error('devices.DELETE failed', { err })
    return NextResponse.json({ error: translate('devices.errors.delete_failed', 'Failed to delete device') }, { status: 500 })
  }
}

const okResponseSchema = z.object({ ok: z.literal(true), id: z.string().uuid().optional() })
const errorResponseSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'Devices',
  summary: 'Update or deactivate one of your registered devices',
  methods: {
    PUT: {
      summary: 'Update your device',
      description:
        'Updates last-seen, app/OS metadata, and push token for a device owned by the current user. Set pushToken to null to clear a revoked OS permission.',
      requestBody: { schema: updateDeviceSchema },
      responses: [{ status: 200, description: 'Device updated', schema: okResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid payload or id', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 403, description: 'Not the device owner', schema: errorResponseSchema },
        { status: 404, description: 'Device not found', schema: errorResponseSchema },
      ],
    },
    DELETE: {
      summary: 'Deactivate your device',
      description: 'Soft-deletes a device owned by the current user.',
      responses: [{ status: 200, description: 'Device deactivated', schema: okResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid id', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 403, description: 'Not the device owner', schema: errorResponseSchema },
        { status: 404, description: 'Device not found', schema: errorResponseSchema },
      ],
    },
  },
}
