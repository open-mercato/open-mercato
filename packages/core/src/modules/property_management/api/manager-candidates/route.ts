import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { listManagerCandidates } from '../../lib/managers'
import { handleRouteError, resolveStaffContext } from '../routeContext'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['property_management.buildings.manage_all'] },
}

const querySchema = z.object({ search: z.string().max(200).optional() })

const responseSchema = z.object({
  items: z.array(z.object({ userId: z.string().uuid(), name: z.string().nullable(), email: z.string().nullable() })),
})

export async function GET(req: Request) {
  try {
    const context = await resolveStaffContext(req)
    const url = new URL(req.url)
    const query = querySchema.parse({ search: url.searchParams.get('search') ?? undefined })
    const scope = { tenantId: context.tenantId, organizationId: context.organizationId }
    const items = await listManagerCandidates(context.em, scope, query.search ?? null, 50)
    return NextResponse.json({ items })
  } catch (err) {
    return handleRouteError(err, 'property_management.manager_candidates_failed')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Property Management',
  summary: 'Building manager candidates',
  methods: {
    GET: {
      summary: 'Staff users that can be assigned as building managers',
      query: querySchema,
      responses: [{ status: 200, description: 'Candidates', schema: responseSchema }],
    },
  },
}
