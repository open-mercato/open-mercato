import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { registerGlobalEventTap } from '@open-mercato/events/bus'
import { exampleTag } from '../openapi'

type CapturedEvent = {
  event: string
  payload: Record<string, unknown>
  capturedAt: string
}

const CAPTURED_EVENTS_KEY = '__exampleCapturedQaEvents__'
const CAPTURE_TAP_KEY = '__exampleCapturedQaEventsTap__'
const MAX_CAPTURED_EVENTS = 200

const querySchema = z.object({
  event: z.string().trim().optional(),
  prefix: z.string().trim().optional(),
})

function getCapturedEventsStore(): CapturedEvent[] {
  const globalScope = globalThis as Record<string, unknown>
  const existing = globalScope[CAPTURED_EVENTS_KEY]
  if (Array.isArray(existing)) {
    return existing as CapturedEvent[]
  }
  const created: CapturedEvent[] = []
  globalScope[CAPTURED_EVENTS_KEY] = created
  return created
}

function ensureCaptureTap(): void {
  const globalScope = globalThis as Record<string, unknown>
  if (globalScope[CAPTURE_TAP_KEY] === true) return
  globalScope[CAPTURE_TAP_KEY] = true

  registerGlobalEventTap((event, payload) => {
    const normalizedPayload = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : {}
    const store = getCapturedEventsStore()
    store.push({
      event,
      payload: normalizedPayload,
      capturedAt: new Date().toISOString(),
    })
    if (store.length > MAX_CAPTURED_EVENTS) {
      store.splice(0, store.length - MAX_CAPTURED_EVENTS)
    }
  })
}

function matchesScope(event: CapturedEvent, auth: NonNullable<Awaited<ReturnType<typeof getAuthFromRequest>>>) {
  const tenantId = typeof event.payload.tenantId === 'string' ? event.payload.tenantId : null
  if (!tenantId || tenantId !== auth.tenantId) return false
  const organizationId = typeof event.payload.organizationId === 'string' ? event.payload.organizationId : null
  return !organizationId || organizationId === auth.orgId
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['example.view'] },
  DELETE: { requireAuth: true, requireFeatures: ['example.view'] },
}

export async function GET(request: Request) {
  ensureCaptureTap()
  const auth = await getAuthFromRequest(request)
  if (!auth?.tenantId || !auth.orgId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const query = querySchema.parse({
    event: url.searchParams.get('event') ?? undefined,
    prefix: url.searchParams.get('prefix') ?? undefined,
  })

  const items = getCapturedEventsStore().filter((event) => {
    if (!matchesScope(event, auth)) return false
    if (query.event && event.event !== query.event) return false
    if (query.prefix && !event.event.startsWith(query.prefix)) return false
    return true
  })

  return Response.json({ items })
}

export async function DELETE(request: Request) {
  ensureCaptureTap()
  const auth = await getAuthFromRequest(request)
  if (!auth?.tenantId || !auth.orgId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const store = getCapturedEventsStore()
  for (let index = store.length - 1; index >= 0; index -= 1) {
    if (matchesScope(store[index], auth)) {
      store.splice(index, 1)
    }
  }

  return Response.json({ ok: true })
}

export const openApi: OpenApiRouteDoc = {
  tag: exampleTag,
  methods: {
    GET: {
      summary: 'List QA-captured server events for the current tenant scope',
      tags: [exampleTag],
      responses: [
        {
          status: 200,
          description: 'Captured events',
          schema: z.object({
            items: z.array(z.object({
              event: z.string(),
              payload: z.record(z.string(), z.unknown()),
              capturedAt: z.string(),
            })),
          }),
        },
      ],
    },
    DELETE: {
      summary: 'Clear QA-captured server events for the current tenant scope',
      tags: [exampleTag],
      responses: [
        {
          status: 200,
          description: 'Captured events cleared',
          schema: z.object({ ok: z.literal(true) }),
        },
      ],
    },
  },
}
