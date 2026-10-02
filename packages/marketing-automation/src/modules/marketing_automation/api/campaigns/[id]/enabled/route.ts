import { NextResponse } from 'next/server'
import { organizationScopeRequiredResponse, resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import { buildRequestCommandContext, readPathUuid } from '../../../shared.js'

/**
 * Taking a campaign live is its own endpoint, behind its own feature.
 *
 * Enabling is the act that starts messaging real customers, so "can draft a campaign" and "can
 * send to the list" are different grants. Keeping `isEnabled` as a field on save-graph would have
 * let anybody with `campaigns.manage` publish, which is what the separate ACL feature exists to
 * prevent — and the guard is declarative here rather than an `if` buried in a handler.
 */
const routeMetadata = {
  PUT: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.publish'] },
}

export const metadata = routeMetadata

function readCampaignId(req: Request): string | null {
  // .../campaigns/<id>/enabled
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
    const { result } = await commandBus.execute<Record<string, unknown>, { id: string; isEnabled: boolean; updatedAt: string }>(
      'marketing_automation.campaigns.set_enabled',
      { input: { ...(body as Record<string, unknown>), id }, ctx: buildRequestCommandContext(container, auth, req) },
    )
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof CrudHttpError) {
      return NextResponse.json(error.body, { status: error.status })
    }
    throw error
  }
}

export const openApi = {
  PUT: {
    summary: 'Enable or disable a campaign',
    description:
      'Separate from save-graph and gated by `marketing_automation.campaigns.publish`, because enabling is what starts messaging real customers. Refuses to enable a campaign with no steps or no triggers, and honours the expected-version header.',
    tags: ['Marketing Automation'],
    responses: {
      200: { description: 'The new state and version' },
      400: { description: 'The campaign has nothing to run' },
      409: { description: 'Somebody else changed the campaign first' },
    },
  },
}
