import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import { buildRequestCommandContext } from '../../../../../shared.js'
import { MarketingCampaign } from '../../../../../../data/entities.js'
import { readRevision } from '../../../../../../lib/revisions.js'

/**
 * Puts an earlier version back.
 *
 * Applied through the ORDINARY save command, carrying the campaign's current version as the expected one.
 * That is the whole design: a restore is validated, locked, audited and event-emitting exactly like a hand
 * edit, and it becomes a new version rather than rewriting history. Nothing here writes to a table.
 */
const routeMetadata = {
  POST: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.manage'] },
}

export const metadata = routeMetadata

type RestoredTrigger =
  | { kind: 'event'; eventId: string | null }
  | {
      kind: 'schedule'
      scheduleValue: string | null
      reentryAfterDays: number | null
      sweepSource: string | null
      sweepParams: Record<string, unknown> | null
    }

/**
 * Rebuilds the trigger payload the save command expects from the snapshot.
 *
 * A snapshot entry that cannot be turned into a valid trigger is DROPPED rather than sent on: it was
 * written by an older version of this module, and a 400 from deep inside the save would tell the author
 * nothing about which of thirty versions is unusable.
 */
type SaveTrigger = Record<string, unknown>

function readTriggers(raw: unknown): SaveTrigger[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap<SaveTrigger>((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const trigger = entry as Partial<RestoredTrigger> & { kind?: unknown }
    if (trigger.kind === 'schedule') {
      const scheduleValue = (trigger as { scheduleValue?: unknown }).scheduleValue
      if (typeof scheduleValue !== 'string' || !scheduleValue) return []
      const sweepParams = (trigger as { sweepParams?: unknown }).sweepParams
      const reentry = (trigger as { reentryAfterDays?: unknown }).reentryAfterDays
      return [{
        kind: 'schedule',
        scheduleValue,
        reentryAfterDays: typeof reentry === 'number' ? reentry : null,
        sweepSource: typeof (trigger as { sweepSource?: unknown }).sweepSource === 'string'
          ? (trigger as { sweepSource: string }).sweepSource
          : undefined,
        sweepParams: sweepParams && typeof sweepParams === 'object' ? sweepParams : undefined,
      }]
    }
    const eventId = (trigger as { eventId?: unknown }).eventId
    if (typeof eventId !== 'string' || !eventId) return []
    return [{ kind: 'event', eventId }]
  })
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const segments = new URL(req.url).pathname.split('/').filter(Boolean)
  // .../campaigns/<id>/revisions/<version>/restore
  const campaignId = segments[segments.length - 4]
  const version = Number.parseInt(segments[segments.length - 2] ?? '', 10)
  if (!campaignId || !Number.isFinite(version)) return NextResponse.json({ error: 'Missing id or version' }, { status: 400 })

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }

  const campaign = await em.findOne(MarketingCampaign, { id: campaignId, ...scope, deletedAt: null })
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const revision = await readRevision(em, scope, campaign.id, version)
  if (!revision) return NextResponse.json({ error: 'No such version' }, { status: 404 })

  const commandBus = container.resolve<CommandBus>('commandBus')
  try {
    const { result } = await commandBus.execute<Record<string, unknown>, { id: string; updatedAt: string; waitingRuns: number }>(
      'marketing_automation.campaigns.save_graph',
      {
        input: {
          id: campaign.id,
          // The CURRENT version, not the snapshot's: a restore is a write against what is there now, so a
          // concurrent edit must still collide.
          updatedAt: campaign.updatedAt.toISOString(),
          name: revision.name,
          definition: revision.definition,
          triggers: readTriggers(revision.triggers),
          restoredFrom: version,
        },
        ctx: buildRequestCommandContext(container, auth, req),
      },
    )
    return NextResponse.json(result)
  } catch (error) {
    // The save's own errors are already the right ones — a 409 for a concurrent edit, a 400 with a
    // validation code for a snapshot the current rules no longer accept.
    if (isCrudHttpError(error)) return NextResponse.json(error.body, { status: error.status })
    if (error instanceof CrudHttpError) return NextResponse.json(error.body, { status: error.status })
    throw error
  }
}

export const openApi = {
  POST: {
    summary: 'Restore a saved version of a campaign',
    description:
      'Applies the snapshot through the ordinary save command, so it is validated and version-checked, and becomes a NEW version noted as a restore. Answers 409 if somebody edited the campaign since the caller read it, and 400 with a validation code if the snapshot no longer passes the current rules.',
    tags: ['Marketing Automation'],
    responses: {
      200: { description: 'Restored' },
      400: { description: 'The snapshot is no longer a valid campaign' },
      404: { description: 'No such campaign or version' },
      409: { description: 'Changed since it was read' },
    },
  },
}
