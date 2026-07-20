import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveNotificationService, type NotificationService } from './notificationService'

/**
 * Mutation-guard resource kind for notification rows.
 */
export const NOTIFICATION_RESOURCE_KIND = 'notifications.notification'

/**
 * Mutation-guard resource kind for notification delivery settings.
 */
export const NOTIFICATION_SETTINGS_RESOURCE_KIND = 'notifications.settings'

/**
 * Mutation-guard resource kind for a user's channel preferences.
 */
export const NOTIFICATION_PREFERENCE_RESOURCE_KIND = 'notifications.preference'

/**
 * Notification scope context for service calls
 */
export interface NotificationScope {
  tenantId: string
  organizationId: string | null
  userId: string | null
}

/**
 * Resolved notification context from a request
 */
export interface NotificationRequestContext {
  service: NotificationService
  scope: NotificationScope
  ctx: Awaited<ReturnType<typeof resolveRequestContext>>['ctx']
}

function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length ? `${issue.path.join('.')}: ` : ''
      return `${path}${issue.message}`
    })
    .join('; ')
}

export async function notificationValidationErrorResponse(error: z.ZodError): Promise<Response> {
  const { t } = await resolveTranslations()
  const prefix = t('api.errors.invalidPayload', 'Invalid request body')
  const details = formatZodIssues(error)
  return Response.json(
    { error: details ? `${prefix}: ${details}` : prefix },
    { status: 400 },
  )
}

export function notificationCrudErrorResponse(error: unknown): Response | null {
  if (!isCrudHttpError(error)) return null
  return Response.json(error.body ?? { error: 'Notification request failed' }, { status: error.status })
}

/**
 * Resolve notification service and scope from a request.
 * Centralizes the common pattern used across all notification API routes.
 */
export async function resolveNotificationContext(req: Request): Promise<NotificationRequestContext> {
  const { ctx } = await resolveRequestContext(req)
  // Derive the organization the same way every org-scoped write does (see the
  // `devices` registration route and the Phase 6 push custom-send route): the
  // selected-org cookie first, then the caller's own org. `resolveRequestContext`
  // never populates `selectedOrganizationId`, so relying on it alone made every
  // notification tenant-level (org=null) — which then never matched org-scoped
  // devices, push channels, or their org-scoped encryption maps.
  const orgScope = await resolveOrganizationScopeForRequest({
    container: ctx.container,
    auth: ctx.auth,
    request: req,
  })
  return {
    service: resolveNotificationService(ctx.container),
    scope: {
      tenantId: ctx.auth?.tenantId ?? '',
      // This is the *creator's* org, and the push strategy later scopes the recipient's device
      // lookup to it. Same-org and self-notify (the common paths) match; a cross-org notify — an
      // admin in org A notifying a user whose devices live in org B — won't match the recipient's
      // devices, so push is silently dropped for that case. In-app delivery is unaffected. If
      // cross-org push is ever required, scope device lookup by the recipient's org instead.
      organizationId: orgScope?.selectedId ?? ctx.auth?.orgId ?? null,
      userId: ctx.auth?.sub ?? null,
    },
    ctx,
  }
}

/**
 * Mutation-guard options for a notification write.
 */
export interface NotificationMutationGuardOptions {
  resourceKind: string
  resourceId?: string | null
  operation: 'create' | 'update' | 'delete' | 'custom'
  payload?: Record<string, unknown> | null
}

export type GuardedNotificationWriteResult<T> =
  | { ok: true; result: T }
  | { ok: false; response: Response }

/**
 * Run a notification write through the mutation guard lifecycle.
 * Validates before the mutation, performs the write, then runs after-success
 * hooks only when the write succeeded and the guard requested them. Returns the
 * guard's own block response when validation fails so authorization behavior and
 * conflict shapes are preserved.
 */
export async function runGuardedNotificationWrite<T>(
  container: AwilixContainer,
  scope: NotificationScope,
  req: Request,
  options: NotificationMutationGuardOptions,
  write: () => Promise<T>,
): Promise<GuardedNotificationWriteResult<T>> {
  const guarded = await runRouteMutationGuards({
    container,
    req,
    auth: {
      userId: scope.userId ?? '',
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    },
    input: {
      resourceKind: options.resourceKind,
      resourceId: options.resourceId ?? null,
      operation: options.operation,
      mutationPayload: options.payload ?? null,
    },
  })
  if (!guarded.ok) {
    return { ok: false, response: guarded.response }
  }

  const result = await write()

  await guarded.runAfterSuccess()

  return { ok: true, result }
}

/**
 * Create a POST handler for bulk notification creation routes.
 * Used by batch, role, and feature notification endpoints.
 */
export function createBulkNotificationRoute<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  serviceMethod: 'createBatch' | 'createForRole' | 'createForFeature'
) {
  return async function POST(req: Request) {
    const { service, scope, ctx } = await resolveNotificationContext(req)

    const body = await req.json().catch(() => ({}))
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return notificationValidationErrorResponse(parsed.error)
    }

    try {
      const guarded = await runGuardedNotificationWrite(
        ctx.container,
        scope,
        req,
        {
          resourceKind: NOTIFICATION_RESOURCE_KIND,
          operation: 'create',
          payload: parsed.data as Record<string, unknown>,
        },
        () => service[serviceMethod](parsed.data as never, scope),
      )
      if (!guarded.ok) return guarded.response
      const notifications = guarded.result

      return Response.json({
        ok: true,
        count: notifications.length,
        ids: notifications.map((n) => n.id),
      }, { status: 201 })
    } catch (error) {
      const errorResponse = notificationCrudErrorResponse(error)
      if (errorResponse) return errorResponse
      throw error
    }
  }
}

/**
 * Create OpenAPI spec for bulk notification creation routes.
 */
export function createBulkNotificationOpenApi<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  summary: string,
  description?: string
) {
  return {
    POST: {
      summary,
      description,
      tags: ['Notifications'],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema,
          },
        },
      },
      responses: {
        201: {
          description: 'Notifications created',
          content: {
            'application/json': {
              schema: z.object({
                ok: z.boolean(),
                count: z.number(),
                ids: z.array(z.string().uuid()),
              }),
            },
          },
        },
      },
    },
  }
}

/**
 * Create a PUT handler for single notification action routes.
 * Used by read and dismiss endpoints.
 */
export function createSingleNotificationActionRoute(
  serviceMethod: 'markAsRead' | 'dismiss'
) {
  return async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { service, scope, ctx } = await resolveNotificationContext(req)

    try {
      const guarded = await runGuardedNotificationWrite(
        ctx.container,
        scope,
        req,
        {
          resourceKind: NOTIFICATION_RESOURCE_KIND,
          resourceId: id,
          operation: 'update',
        },
        () => service[serviceMethod](id, scope),
      )
      if (!guarded.ok) return guarded.response
    } catch (error) {
      const errorResponse = notificationCrudErrorResponse(error)
      if (errorResponse) return errorResponse
      throw error
    }

    return Response.json({ ok: true })
  }
}

/**
 * Create OpenAPI spec for single notification action routes.
 */
export function createSingleNotificationActionOpenApi(
  summary: string,
  description: string
) {
  return {
    PUT: {
      summary,
      tags: ['Notifications'],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: {
        200: {
          description,
          content: {
            'application/json': {
              schema: z.object({ ok: z.boolean() }),
            },
          },
        },
      },
    },
  }
}
