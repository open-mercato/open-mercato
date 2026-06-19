import { z } from 'zod'
import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveNotificationService, type NotificationService } from './notificationService'

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
  return {
    service: resolveNotificationService(ctx.container),
    scope: {
      tenantId: ctx.auth?.tenantId ?? '',
      organizationId: ctx.selectedOrganizationId ?? null,
      userId: ctx.auth?.sub ?? null,
    },
    ctx,
  }
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
    const { service, scope } = await resolveNotificationContext(req)

    const body = await req.json().catch(() => ({}))
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return notificationValidationErrorResponse(parsed.error)
    }

    try {
      const notifications = await service[serviceMethod](parsed.data as never, scope)

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
    const { service, scope } = await resolveNotificationContext(req)

    try {
      await service[serviceMethod](id, scope)
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
