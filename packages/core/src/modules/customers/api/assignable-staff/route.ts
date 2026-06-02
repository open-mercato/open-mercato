import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createPagedListResponseSchema } from '../openapi'

const querySchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(24),
    search: z.string().optional(),
  })
  .passthrough()

const itemSchema = z.object({
  id: z.string().uuid(),
  teamMemberId: z.string().uuid(),
  userId: z.string().uuid(),
  displayName: z.string(),
  email: z.string().nullable().optional(),
  teamName: z.string().nullable().optional(),
  user: z
    .object({
      id: z.string().uuid(),
      email: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  team: z
    .object({
      id: z.string().uuid(),
      name: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
})

const errorSchema = z.object({ error: z.string() })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.roles.view'] },
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const target = new URL('/api/staff/team-members/assignable', url.origin)
  target.search = url.search
  return NextResponse.redirect(target, 308)
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Assignable staff candidates (DEPRECATED — redirects to /api/staff/team-members/assignable)',
  methods: {
    GET: {
      deprecated: true,
      summary: 'DEPRECATED: use GET /api/staff/team-members/assignable instead.',
      query: querySchema,
      description:
        'Deprecated. Returns 308 Permanent Redirect to /api/staff/team-members/assignable preserving the query string. Will be removed no earlier than the next major release.',
      responses: [
        {
          status: 200,
          description: 'Assignable staff members (only reachable by following the redirect).',
          schema: createPagedListResponseSchema(itemSchema),
        },
        {
          status: 308,
          description: 'Permanent redirect to /api/staff/team-members/assignable.',
          schema: errorSchema,
        },
      ],
      errors: [
        { status: 400, description: 'Invalid request', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Forbidden', schema: errorSchema },
      ],
    },
  },
}
