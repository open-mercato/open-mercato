import { z } from 'zod'
import { getAuthFromCookies, getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  assigneeQuerySchema,
  exampleErrorSchema,
  exampleTag,
  optionsResponseSchema,
} from '../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['example.todos.view'] },
  POST: { requireAuth: true, requireFeatures: ['example.todos.manage'] },
}

type Option = { value: string; label: string }

const ALL: Option[] = [
  { value: 'u_123', label: 'Alice Johnson' },
  { value: 'u_456', label: 'Bob Smith' },
  { value: 'u_789', label: 'Charlie Adams' },
  { value: 'u_321', label: 'Daria Lopez' },
  { value: 'u_654', label: 'Evan Kim' },
  { value: 'u_987', label: 'Fatima Khan' },
]

export async function GET(request: Request) {
  try {
    const auth = await getAuthFromCookies()
    if (!auth?.orgId) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })
    }

    const { searchParams } = new URL(request.url)
    const q = (searchParams.get('q') || '').toLowerCase().trim()
    const items = q
      ? ALL.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q))
      : ALL

    return new Response(JSON.stringify({ items }), {
      headers: { 'content-type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
}

const emitSseTestSchema = z.object({
  eventId: z.enum(['example.todo.created', 'example.todo.updated', 'example.todo.deleted']).default('example.todo.updated'),
  payload: z.record(z.string(), z.unknown()).optional().default({}),
  organizationId: z.string().uuid().nullable().optional(),
  organizationIds: z.array(z.string().uuid()).optional(),
  recipientUserId: z.string().uuid().optional(),
  recipientUserIds: z.array(z.string().uuid()).optional(),
  recipientRoleId: z.string().min(1).optional(),
  recipientRoleIds: z.array(z.string().min(1)).optional(),
})

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub || !auth.tenantId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })
  }

  const rawBody = await req.json().catch(() => ({}))
  const parsed = emitSseTestSchema.safeParse(rawBody)
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'Invalid payload', issues: parsed.error.issues }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  const container = await createRequestContainer()
  const eventBus = container.resolve<{
    emitEvent: (event: string, payload: Record<string, unknown>, options?: { persistent?: boolean }) => Promise<void>
  }>('eventBus')

  const eventPayload: Record<string, unknown> = {
    ...(parsed.data.payload ?? {}),
    tenantId: auth.tenantId,
    organizationId: parsed.data.organizationId ?? auth.orgId ?? null,
  }

  if (Array.isArray(parsed.data.organizationIds) && parsed.data.organizationIds.length > 0) {
    eventPayload.organizationIds = parsed.data.organizationIds
  }
  if (typeof parsed.data.recipientUserId === 'string') {
    eventPayload.recipientUserId = parsed.data.recipientUserId
  }
  if (Array.isArray(parsed.data.recipientUserIds) && parsed.data.recipientUserIds.length > 0) {
    eventPayload.recipientUserIds = parsed.data.recipientUserIds
  }
  if (typeof parsed.data.recipientRoleId === 'string') {
    eventPayload.recipientRoleId = parsed.data.recipientRoleId
  }
  if (Array.isArray(parsed.data.recipientRoleIds) && parsed.data.recipientRoleIds.length > 0) {
    eventPayload.recipientRoleIds = parsed.data.recipientRoleIds
  }

  await eventBus.emitEvent(parsed.data.eventId, eventPayload, { persistent: false })

  return new Response(JSON.stringify({ ok: true, eventId: parsed.data.eventId, payload: eventPayload }), {
    headers: { 'content-type': 'application/json' },
  })
}

const assigneesGetDoc: OpenApiMethodDoc = {
  summary: 'List example assignees',
  description: 'Returns mock assignee options filtered by the optional `q` query parameter.',
  tags: [exampleTag],
  query: assigneeQuerySchema,
  responses: [
    { status: 200, description: 'Assignable users.', schema: optionsResponseSchema },
  ],
  errors: [
    { status: 401, description: 'Authentication required', schema: exampleErrorSchema },
    { status: 500, description: 'Unexpected server error', schema: exampleErrorSchema },
  ],
}

const assigneesPostDoc: OpenApiMethodDoc = {
  summary: 'Emit SSE probe event for integration tests',
  description: 'Emits a clientBroadcast example todo event with optional recipient filters (user/role/org).',
  tags: [exampleTag],
  responses: [
    {
      status: 200,
      description: 'Event emitted',
      schema: z.object({
        ok: z.literal(true),
        eventId: z.string(),
        payload: z.record(z.string(), z.unknown()),
      }),
    },
  ],
  errors: [
    { status: 400, description: 'Invalid payload', schema: exampleErrorSchema },
    { status: 401, description: 'Authentication required', schema: exampleErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: exampleTag,
  summary: 'Example assignee options',
  methods: {
    GET: assigneesGetDoc,
    POST: assigneesPostDoc,
  },
}
