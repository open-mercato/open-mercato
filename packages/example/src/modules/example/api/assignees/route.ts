import { getAuthFromCookies } from '@/lib/auth/server'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  assigneeQuerySchema,
  exampleErrorSchema,
  exampleTag,
  optionsResponseSchema,
} from '../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['example.todos.view'] },
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

export const openApi: OpenApiRouteDoc = {
  tag: exampleTag,
  summary: 'Example assignee options',
  methods: {
    GET: assigneesGetDoc,
  },
}
