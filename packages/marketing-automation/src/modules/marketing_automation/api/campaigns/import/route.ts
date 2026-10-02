import { NextResponse } from 'next/server'
import { reportError } from '@open-mercato/telemetry'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import { MarketingCampaign } from '../../../data/entities.js'
import { findUnportableReferences, portableCampaignSchema } from '../../../lib/portable.js'
import { buildRequestCommandContext, commandErrorResponse } from '../../shared.js'

/**
 * Creates a campaign from an exported document, or from a template.
 *
 * **Always disabled, whatever the document says.** The enabled flag is not even carried by the format: an import
 * that could arrive live would mean opening somebody's file starts messaging real customers, and a campaign
 * nobody has read is exactly the campaign that should not be sending.
 *
 * Behind `campaigns.manage` rather than `publish`, because importing creates a draft and nothing more. The graph
 * goes through the ordinary save command, so every save-time rule applies unchanged — unknown step types,
 * trailing waits, self-driving cycles and malformed params are all refused here exactly as they are in the
 * editor. That is the entire reason this endpoint is small.
 */
const routeMetadata = {
  POST: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.manage'] },
}

export const metadata = routeMetadata

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = portableCampaignSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return NextResponse.json(
      {
        error: issue ? `${issue.path.join('.') || 'document'}: ${issue.message}` : 'Unusable document',
        code: 'marketing_automation.validation.invalidPayload',
      },
      { status: 400 },
    )
  }

  const container = await createRequestContainer()
  const commandBus = container.resolve<CommandBus>('commandBus')
  const ctx = buildRequestCommandContext(container, auth, req)

  /**
   * The id of the campaign this request created, so a later failure can take it back.
   *
   * An import is two commands — `create` makes an empty disabled campaign and `save_graph` validates and
   * stores the graph — and when the second refused the first had already committed. So a document the save
   * rules reject answered 400 and left a nameless empty campaign in the list, one per attempt, which an
   * operator then had to find and delete by hand with no idea where they came from.
   */
  let createdId: string | null = null

  try {
    const { result: created } = await commandBus.execute<{ name: string; description?: string | null }, { id: string }>(
      'marketing_automation.campaigns.create',
      { input: { name: parsed.data.name, description: parsed.data.description ?? null }, ctx },
    )
    createdId = created.id

    /**
     * The graph is saved through the ordinary command, with the version the create just produced.
     *
     * Two calls rather than one, because that is what the module already has: `create` makes an empty disabled
     * campaign and `save_graph` validates and stores the authored graph. Reusing both means an imported campaign
     * cannot be in a state an authored one could not be in.
     *
     * The version has to be READ BACK: `save_graph` requires the expected version and refuses to default it,
     * which is the rule that stops the optimistic lock being switched off by a convenient fallback. The create
     * answers with an id alone, so the row is re-read for its `updatedAt` — one query, and no exception to a
     * rule worth keeping absolute.
     */
    const em = container.resolve<EntityManager>('em')
    const fresh = await em.findOne(MarketingCampaign, {
      id: created.id,
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
      deletedAt: null,
    })
    if (!fresh) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const { result: saved } = await commandBus.execute<Record<string, unknown>, { id: string; updatedAt: string }>(
      'marketing_automation.campaigns.save_graph',
      {
        input: {
          id: created.id,
          updatedAt: fresh.updatedAt.toISOString(),
          name: parsed.data.name,
          description: parsed.data.description ?? null,
          definition: parsed.data.definition,
          triggers: parsed.data.triggers,
        },
        ctx,
      },
    )

    return NextResponse.json({
      id: created.id,
      updatedAt: saved.updatedAt,
      /**
       * References the document brought from somewhere else.
       *
       * A tag id or a block id from another installation names a row that does not exist here. Reported rather
       * than stripped: "this step points at a tag from the other shop, pick one here" is a five-second fix, while
       * silently dropping the parameter would leave a step that looks configured and does nothing.
       */
      warnings: findUnportableReferences(parsed.data.definition),
    }, { status: 201 })
  } catch (error) {
    /**
     * Take the half-made campaign back before answering.
     *
     * A compensating delete rather than validating the graph up front: validation would close the case the
     * review found and not the others — a transient database error, a trigger the save rules refuse, anything
     * `save_graph` can throw. Through the ordinary delete command, with the version read back, so the removal
     * is audited exactly like a deliberate one.
     *
     * Its own failure is swallowed deliberately. The caller is already being told their import failed, and
     * replacing that with "could not clean up" would hide the answer they need behind one they cannot act on.
     */
    if (createdId) {
      try {
        const em = container.resolve<EntityManager>('em')
        const orphan = await em.findOne(MarketingCampaign, {
          id: createdId,
          tenantId: auth.tenantId,
          organizationId: auth.orgId,
          deletedAt: null,
        })
        if (orphan) {
          await commandBus.execute(
            'marketing_automation.campaigns.delete',
            { input: { id: createdId, updatedAt: orphan.updatedAt.toISOString() }, ctx },
          )
        }
      } catch (cleanupError) {
        reportError(cleanupError, {
          module: 'marketing_automation',
          code: 'marketing_automation.import_rollback_failed',
          attributes: { campaignId: createdId },
        })
      }
    }
    return commandErrorResponse(error)
  }
}

export const openApi = {
  POST: {
    summary: 'Create a campaign from an exported document or a template',
    description:
      'Accepts the document the export endpoint produces. The campaign is created DISABLED whatever the document says, and the graph goes through the ordinary save command so every save-time rule applies. Answers 201 with any uuid-shaped step parameters that came from another installation and will not resolve here.',
    tags: ['Marketing Automation'],
    responses: {
      201: { description: 'The created campaign id, and any unportable references' },
      400: { description: 'Unusable document, or a graph the save rules refuse' },
    },
  },
}
