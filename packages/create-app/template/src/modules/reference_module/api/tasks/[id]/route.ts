import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { GET as listTasks, PUT as updateTask, DELETE as deleteTask } from '../route'

const paramsSchema = z.object({ id: z.string().uuid() })

function forwardUrl(request: Request, id: string): URL {
  const url = new URL(request.url)
  url.pathname = '/api/reference_module/tasks'
  url.searchParams.set('id', id)
  return url
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['reference_module.view'] },
  PUT: { requireAuth: true, requireFeatures: ['reference_module.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['reference_module.manage'] },
}

export async function GET(request: Request, context: { params?: { id?: string } }) {
  const { id } = paramsSchema.parse(context.params)
  const response = await listTasks(new Request(forwardUrl(request, id), { headers: request.headers }))
  const body = await response.json() as { items?: unknown[] }
  if (!response.ok) return NextResponse.json(body, { status: response.status, headers: response.headers })
  const item = body.items?.[0]
  return item
    ? NextResponse.json(item, { headers: response.headers })
    : NextResponse.json({ error: 'Reference task not found' }, { status: 404 })
}

export async function PUT(request: Request, context: { params?: { id?: string } }) {
  const { id } = paramsSchema.parse(context.params)
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  return updateTask(new Request(forwardUrl(request, id), {
    method: 'PUT',
    headers: request.headers,
    body: JSON.stringify({ ...body, id }),
  }))
}

export async function DELETE(request: Request, context: { params?: { id?: string } }) {
  const { id } = paramsSchema.parse(context.params)
  return deleteTask(new Request(forwardUrl(request, id), {
    method: 'DELETE',
    headers: request.headers,
    body: JSON.stringify({ id }),
  }))
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Reference module',
  summary: 'Reference task detail',
  methods: {
    GET: { summary: 'Get reference task', responses: [{ status: 200, description: 'Scoped task detail' }, { status: 404, description: 'Task not found' }] },
    PUT: { summary: 'Update reference task', responses: [{ status: 200, description: 'Task updated' }, { status: 409, description: 'Optimistic-lock conflict' }] },
    DELETE: { summary: 'Delete reference task', responses: [{ status: 200, description: 'Task deleted' }, { status: 409, description: 'Optimistic-lock conflict' }] },
  },
}
