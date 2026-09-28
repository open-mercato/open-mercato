import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { listJobRuns } from '../../lib/job-runs.js'

/**
 * What the background jobs have been doing.
 *
 * Behind `runs.view` rather than `campaigns.manage`: this is the operational question — did the machinery
 * run — and the person asking it at 9am is often not the person allowed to edit campaigns.
 */
const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['marketing_automation.runs.view'] },
}

export const metadata = routeMetadata

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) return NextResponse.json({ items: [] }, { status: 401 })

  const url = new URL(req.url)
  const kind = url.searchParams.get('kind') ?? undefined
  const limit = Number.parseInt(url.searchParams.get('limit') ?? '50', 10) || 50

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }

  return NextResponse.json({ items: await listJobRuns(em, scope, { kind, limit }) })
}

export const openApi = {
  GET: {
    summary: 'List background job executions',
    description: 'Newest first, with the counters each job produced. A `running` row with an old start time is a job that never finished, which is the state this endpoint exists to make visible.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'Job runs, newest first' } },
  },
}
