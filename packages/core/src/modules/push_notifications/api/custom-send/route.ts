import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  bridgeLegacyGuard,
  runMutationGuards,
  type MutationGuard,
  type MutationGuardInput,
} from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import type { AwilixContainer } from 'awilix'
import {
  customSendSchema,
  customSendResponseSchema,
  CUSTOM_SEND_NO_DEVICES_WARNING,
} from '../../data/validators'
import type { PushNotificationService } from '../../lib/send-custom-push'

const logger = createLogger('push_notifications')

const RESOURCE_KIND = 'push_notifications.push_notification_delivery'

const errorResponseSchema = z.object({ error: z.string() })

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['push_notifications.send_custom'] },
}

function resolveUserFeatures(auth: unknown): string[] {
  const features = (auth as { features?: unknown })?.features
  if (!Array.isArray(features)) return []
  return features.filter((value): value is string => typeof value === 'string')
}

async function runGuards(
  container: AwilixContainer,
  userFeatures: string[],
  input: MutationGuardInput,
): Promise<{
  ok: boolean
  errorBody?: Record<string, unknown>
  errorStatus?: number
  afterSuccessCallbacks: Array<{ guard: MutationGuard; metadata: Record<string, unknown> | null }>
}> {
  const legacyGuard = bridgeLegacyGuard(container)
  if (!legacyGuard) return { ok: true, afterSuccessCallbacks: [] }
  return runMutationGuards([legacyGuard], input, { userFeatures })
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
    const organizationId = scope?.selectedId ?? auth.orgId ?? null

    // Custom write route → wire the mutation-guard registry (AGENTS → API Routes). The send creates
    // append-only delivery rows; map it to a `create` on the delivery resource keyed by recipient.
    const guardInput: MutationGuardInput = {
      tenantId: auth.tenantId,
      organizationId,
      userId: auth.sub,
      resourceKind: RESOURCE_KIND,
      resourceId: body.recipientUserId,
      operation: 'create',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: body,
    }
    const guardResult = await runGuards(container, resolveUserFeatures(auth), guardInput)
    if (!guardResult.ok) {
      return NextResponse.json(
        guardResult.errorBody ?? { error: translate('push_notifications.errors.send_failed', 'Operation blocked') },
        { status: guardResult.errorStatus ?? 422 },
      )
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

    for (const callback of guardResult.afterSuccessCallbacks) {
      if (!callback.guard.afterSuccess) continue
      await callback.guard.afterSuccess({
        ...guardInput,
        resourceId: body.recipientUserId,
        metadata: callback.metadata ?? null,
      })
    }

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
