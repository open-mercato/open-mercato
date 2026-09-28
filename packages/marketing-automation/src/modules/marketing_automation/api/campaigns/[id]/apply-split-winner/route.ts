import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import { buildRequestCommandContext } from '../../../shared.js'

/**
 * Ends an A/B test by promoting the winning lane.
 *
 * Behind `campaigns.manage` rather than a reporting permission: this REWRITES the campaign. Somebody
 * who may read results is not necessarily somebody who may change what customers receive next.
 */
const routeMetadata = {
  POST: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.manage'] },
}

export const metadata = routeMetadata

function readCampaignId(req: Request): string | null {
  const segments = new URL(req.url).pathname.split('/').filter(Boolean)
  // .../campaigns/<id>/apply-split-winner
  return segments[segments.length - 2] ?? null
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = readCampaignId(req)
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const body = await req.json().catch(() => null) as { updatedAt?: string; stepId?: string; variantKey?: string } | null
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

  const container = await createRequestContainer()
  const commandBus = container.resolve<CommandBus>('commandBus')

  try {
    const { result } = await commandBus.execute<Record<string, unknown>, unknown>(
      'marketing_automation.campaigns.apply_split_winner',
      {
        // Deliberately NOT `?? ''`: an empty string is a value, and the platform guard only falls back
        // to the extension header when the expected version is absent. Defaulting it silently turned
        // the optimistic lock into a no-op for any client that sends the version as a header — which is
        // what this endpoint's own description promises to honour.
        input: { id, updatedAt: body.updatedAt, stepId: body.stepId ?? '', variantKey: body.variantKey ?? '' },
        ctx: buildRequestCommandContext(container, auth, req),
      },
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
  POST: {
    summary: 'Promote the winning variant of a split',
    description:
      'Replaces the split with the winning lane\'s steps, in place, so subjects already in that lane keep walking the same chain. Requires the updatedAt the client last read; a mismatch answers 409. Refuses a promotion whose result would not be runnable.',
    tags: ['Marketing Automation'],
    responses: {
      200: { description: 'Applied, with the new updatedAt' },
      404: { description: 'No such split or variant' },
      409: { description: 'The campaign changed since it was read' },
    },
  },
}
