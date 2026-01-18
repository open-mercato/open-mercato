import { z } from 'zod'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { exampleTag, exampleErrorSchema } from '../../openapi'

export const requireAuth = true
export const requireFeatures = ['example.todos.view']

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  return new Response(JSON.stringify({ id: ctx.params.id, method: 'GET' }), {
    headers: { 'content-type': 'application/json' },
  })
}

export async function POST(_req: Request, ctx: { params: { id: string } }) {
  return new Response(JSON.stringify({ id: ctx.params.id, method: 'POST' }), {
    headers: { 'content-type': 'application/json' },
  })
}

const blogPathParamsSchema = z.object({
  id: z.string(),
})

const blogGetResponseSchema = z.object({
  id: z.string(),
  method: z.literal('GET'),
})

const blogPostResponseSchema = z.object({
  id: z.string(),
  method: z.literal('POST'),
})

const blogGetDoc: OpenApiMethodDoc = {
  summary: 'Fetch demo blog payload',
  description: 'Returns a placeholder blog record containing the provided identifier.',
  tags: [exampleTag],
  responses: [
    { status: 200, description: 'Placeholder blog payload.', schema: blogGetResponseSchema },
  ],
  errors: [
    { status: 401, description: 'Authentication required', schema: exampleErrorSchema },
  ],
}

const blogPostDoc: OpenApiMethodDoc = {
  summary: 'Create demo blog payload',
  description: 'Echoes the provided identifier as a placeholder write endpoint.',
  tags: [exampleTag],
  responses: [
    { status: 200, description: 'Placeholder confirmation.', schema: blogPostResponseSchema },
  ],
  errors: [
    { status: 401, description: 'Authentication required', schema: exampleErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: exampleTag,
  summary: 'Example blog demo',
  pathParams: blogPathParamsSchema,
  methods: {
    GET: blogGetDoc,
    POST: blogPostDoc,
  },
}
