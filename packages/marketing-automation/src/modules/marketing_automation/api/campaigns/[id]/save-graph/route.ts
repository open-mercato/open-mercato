import { NextResponse } from 'next/server'
import { campaignGraphSaveSchema } from '../../../../data/validators.js'
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
  /**
   * Parsed here as well as in the command, so the whitelist below has typed fields to copy.
   *
   * The command parses again and owns the refusal codes; this parse exists to stop the route handing it a bag
   * of whatever arrived.
   */
  const parsed = campaignGraphSaveSchema.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return NextResponse.json(
      {
        error: issue ? `${issue.path.join('.') || 'payload'}: ${issue.message}` : 'Invalid request body',
        code: 'marketing_automation.validation.invalidPayload',
      },
      { status: 400 },
    )
  }
  const payload = parsed.data

  const container = await createRequestContainer()
  const commandBus = container.resolve<CommandBus>('commandBus')

  try {
    const { result } = await commandBus.execute<Record<string, unknown>, { id: string; updatedAt: string; waitingRuns: number }>(
      'marketing_automation.campaigns.save_graph',
      {
        /**
         * The fields the schema defines, named — never the body spread.
         *
         * Spreading let a client send `restoredFrom`, which the command threads into the revision note: the
         * history would then read "restored:7" for a save that restored nothing, and the version list is the
         * one record an author trusts when they are trying to undo something. `restoredFrom` is internal and
         * the restore endpoint sets it by calling the command directly.
         *
         * A whitelist rather than a blacklist, so the next internal-only field is protected by having been
         * written rather than by somebody remembering this.
         */
        input: {
          id,
          updatedAt: payload.updatedAt,
          name: payload.name,
          description: payload.description,
          triggers: payload.triggers,
          definition: payload.definition,
        },
        ctx: buildRequestCommandContext(container, auth, req),
      },
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
