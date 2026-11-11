import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveSingleOrganizationIdOrDeny } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import {
  customSendSchema,
  customSendResponseSchema,
  CUSTOM_SEND_NO_DEVICES_WARNING,
} from '../../data/validators'
import type { PushNotificationService } from '../../lib/send-custom-push'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const logger = createLogger('push_notifications')

const RESOURCE_KIND = 'push_notifications.push_notification_delivery'

const errorResponseSchema = z.object({ error: z.string() })

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['push_notifications.send_custom'] },
}

export async function POST(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    if (!auth || !auth.tenantId || !auth.sub) {
      return NextResponse.json(
        { error: translate('push_notifications.errors.unauthorized', 'Unauthorized') },
        { status: 401 },
      )
    }

    const body = customSendSchema.parse(await readJsonSafe(req, {}))
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const organizationId = resolveSingleOrganizationIdOrDeny(scope, auth) ?? null

    // Custom write route → wire the mutation-guard registry (AGENTS → API Routes). The send creates
    // append-only delivery rows; map it to a `create` on the delivery resource keyed by recipient.
    const guardResult = await runRouteMutationGuards({
      container,
      req,
      auth: {
        tenantId: auth.tenantId,
        organizationId,
        userId: auth.sub,
      },
      input: {
        resourceKind: RESOURCE_KIND,
        resourceId: body.recipientUserId,
        operation: 'create',
        mutationPayload: body,
      },
    })
    if (!guardResult.ok) {
      return guardResult.response
    }

    const service = container.resolve('pushNotificationService') as PushNotificationService
    const result = await service.sendCustomPush({
      resolve: (<T = unknown,>(name: string): T => container.resolve(name) as T),
      tenantId: auth.tenantId,
      userId: body.recipientUserId,
      organizationId,
      deviceId: body.deviceId,
      title: body.title,
      body: body.body ?? null,
      data: body.data,
      pushOptions: body.pushOptions,
      silent: body.silent ?? false,
    })

    await guardResult.runAfterSuccess()

    // A well-formed request that enqueued nothing (no push channel, no in-scope device, or no device
    // whose provider matches an active channel) previously returned a bare 201 — a silent
    // success-with-no-send that hid, for example, a tenant-level admin targeting org-scoped devices.
    // Surface an explicit machine-readable warning + human message so the caller can react.
    const responseBody: z.infer<typeof customSendResponseSchema> =
      result.enqueued === 0
        ? {
            enqueued: 0,
            warning: CUSTOM_SEND_NO_DEVICES_WARNING,
            message: translate(
              'push_notifications.warnings.no_matching_devices_in_scope',
              'No push-capable devices matched this recipient in the selected scope, so nothing was sent.',
            ),
          }
        : { enqueued: result.enqueued }

    // 201 Created only when jobs were actually enqueued; the no-op branch returns 200 OK so callers
    // that key off the status code aren't told something was created when nothing was.
    return NextResponse.json(responseBody, { status: result.enqueued === 0 ? 200 : 201 })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: translate('push_notifications.errors.invalid_payload', 'Invalid request'), details: err.flatten() },
        { status: 400 },
      )
    }
    logger.error('push_notifications.custom-send.POST failed', { err })
    return NextResponse.json(
      { error: translate('push_notifications.errors.send_failed', 'Failed to send push notification') },
      { status: 500 },
    )
  }
}

export const openApi = {
  POST: {
    summary: 'Send a custom push notification',
    description:
      "Admin-only: deliver a one-off, free-text visible push to all of a single user's push-capable devices. No in-app notification or email is created.",
    tags: ['PushNotifications'],
    requestBody: { schema: customSendSchema },
    responses: {
      200: {
        description:
          'Nothing was deliverable in scope: `enqueued` is 0 and a `warning` code plus human `message` explain why (no silent no-op). Returned instead of 201 because nothing was created.',
        content: { 'application/json': { schema: customSendResponseSchema } },
      },
      201: {
        description: 'Per-device push jobs enqueued.',
        content: { 'application/json': { schema: customSendResponseSchema } },
      },
      400: {
        description: 'Invalid request',
        content: { 'application/json': { schema: errorResponseSchema } },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: errorResponseSchema } },
      },
    },
  },
}
