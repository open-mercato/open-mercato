import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { CAMPAIGN_TEMPLATES } from '../../lib/templates.js'

/**
 * The ready-made campaigns an author can start from.
 *
 * Static data, so no database is touched — but still authenticated, because the list describes what this
 * installation can do and there is no reason to answer it for anybody who walks past.
 *
 * The documents themselves are returned in full rather than by reference: the client needs them to POST to the
 * import endpoint, which is the ONLY way a template becomes a campaign. One code path for "create from a file"
 * and "create from a template" means a template cannot produce a campaign an import could not.
 */
const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.view'] },
}

export const metadata = routeMetadata

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  return NextResponse.json({
    items: CAMPAIGN_TEMPLATES.map((template) => ({
      id: template.id,
      labelKey: template.labelKey,
      descriptionKey: template.descriptionKey,
      requiresKey: template.requiresKey,
      /** A summary for the picker, so it can say "three steps, one trigger" without parsing the document. */
      stepCount: template.document.definition.steps.length,
      triggerCount: template.document.triggers.length,
      document: template.document,
    })),
  })
}

export const openApi = {
  GET: {
    summary: 'List the ready-made campaign templates',
    description:
      'Static documents in the portable campaign format, each ready to POST to the import endpoint — which is the only way one becomes a campaign, so a template cannot produce something an import could not. Requires `campaigns.view`.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'The templates, with their documents' } },
  },
}
