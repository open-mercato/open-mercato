import { NextResponse } from 'next/server'
import { organizationScopeRequiredResponse, resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CAMPAIGN_TEMPLATES, localizeCampaignTemplate } from '../../lib/templates.js'

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
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  /**
   * A scope that cannot be resolved is a 400, never a 401.
   *
   * `apiFetch` reads 401 as an expired session: it refreshes, succeeds, returns to the same page and
   * refreshes again — so answering 401 for "All organizations" did not fail, it looped for ever. The
   * resolver also recovers the actor's own organization where that is still the actor's tenant, which is
   * what keeps a super-admin's own configuration visible instead of unreachable.
   */
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()

  /**
   * The documents ship English copy and are translated on the way out.
   *
   * An author who starts from a template is going to rewrite the words anyway, but handing a Polish shop a
   * Polish first draft is the difference between editing and translating. A locale with no copy written for it
   * falls back to the English literal, so a template is never served with an empty subject line.
   */
  const { translate } = await resolveTranslations()
  const localized = CAMPAIGN_TEMPLATES.map((template) => localizeCampaignTemplate(template, translate))

  return NextResponse.json({
    items: localized.map((template) => ({
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
