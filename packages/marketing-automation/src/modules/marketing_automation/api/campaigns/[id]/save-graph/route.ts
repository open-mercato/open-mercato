import { NextResponse } from 'next/server'
import { organizationScopeRequiredResponse, resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import { buildRequestCommandContext, readPathUuid } from '../../../shared.js'

const routeMetadata = {
  PUT: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.manage'] },
}

export const metadata = routeMetadata

function readCampaignId(req: Request): string | null {
  // .../campaigns/<id>/save-graph
  return readPathUuid(req, 2)
}

export async function PUT(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  /**
   * A scope that cannot be resolved is a 400, never a 401.
   *
   * `apiFetch` reads 401 as an expired session: it refreshes, succeeds, returns to the same page and
   * refreshes again — so answering 401 for "All organizations" did not fail, it looped for ever.
   */
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const id = readCampaignId(req)
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const commandBus = container.resolve<CommandBus>('commandBus')

  try {
    const { result } = await commandBus.execute<Record<string, unknown>, { id: string; updatedAt: string; waitingRuns: number }>(
      'marketing_automation.campaigns.save_graph',
      { input: { ...(body as Record<string, unknown>), id }, ctx: buildRequestCommandContext(container, auth, req) },
    )
    return NextResponse.json(result)
  } catch (error) {
    // The 409 carries the current version so the client can show a conflict bar rather than a
    // generic failure, and the author can see what they are up against.
    if (error instanceof CrudHttpError) {
      return NextResponse.json(error.body, { status: error.status })
    }
    throw error
  }
}

export const openApi = {
  PUT: {
    summary: 'Save a campaign graph',
    description:
      'Replaces the campaign name, enabled flag, triggers and authored definition in one write. Requires the updatedAt the client last read; a mismatch answers 409 with the current value.',
    tags: ['Marketing Automation'],
    responses: {
      200: { description: 'Saved, with the new updatedAt and the number of customers waiting mid-journey' },
      400: { description: 'The graph is not runnable in this installation' },
      409: { description: 'Somebody else saved the campaign first' },
    },
  },
}
