import { NextResponse } from 'next/server'
import { organizationScopeRequiredResponse, resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { listMarketingSteps } from '../../lib/engine/registry.js'
import { triggerCatalogFor } from '../../lib/trigger-catalog.js'
import { sweepSourceCatalog } from '../../lib/sweep-sources.js'
import { listContentBlockKeys } from '../../lib/content-blocks.js'
import { loadSegmentDefinitions } from '../../lib/segments.js'
import { AUDIENCE_FIELDS } from '../../lib/audience/field-catalog.js'
import { loadCategoryOptions, loadChannelOptions, loadTagOptions } from '../../lib/audience/field-options.js'
import { loadTierThresholds } from '../../lib/tiers.js'
import { getSupportedLocales } from '@open-mercato/shared/lib/i18n/locale-set'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { readCapabilities } from '../../lib/capabilities.js'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.view'] },
}

export const metadata = routeMetadata

/**
 * What the canvas palette offers.
 *
 * Derived from the live registries rather than a hardcoded list, which is what makes a step type
 * contributed by another module appear with a working inspector form and no UI code of its own.
 * Unavailable triggers are returned too, with their reason, so the palette can show them
 * disabled instead of leaving somebody to wonder why a famous trigger is missing.
 */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) {
    return NextResponse.json(
      { triggers: [], steps: [], sweepSources: [], contentBlocks: [], segments: [], audienceFields: [], audienceOptions: {} },
      { status: 401 },
    )
  }
  /**
   * A scope that cannot be resolved is a 400, never a 401.
   *
   * `apiFetch` reads 401 as an expired session: it refreshes, succeeds, returns to the same page and
   * refreshes again — so answering 401 for "All organizations" did not fail, it looped for ever.
   */
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const scope = { tenantId: auth.tenantId, organizationId }

  /**
   * The only tenant data in this response, and the reason it needs a query: an author cannot reference a
   * content block whose key they have to remember.
   */
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const contentBlocks = await listContentBlockKeys(em, scope)
  // Offered so an author can target a saved segment without remembering its reference.
  const segments = (await loadSegmentDefinitions(em, scope)).map((segment) => ({ slug: segment.slug, name: segment.name }))

  /**
   * What the audience editor's dropdowns are filled with.
   *
   * Every list is a fact about THIS shop, which is why they are queried rather than written down: a
   * hardcoded set of categories is wrong for every tenant but the one it was written for. Fetched together
   * because the editor cannot render a single row without them, so splitting them across requests would
   * only produce a form that fills in piecemeal.
   */
  const [tags, categories, channels, tierThresholds] = await Promise.all([
    loadTagOptions(em, scope),
    loadCategoryOptions(em, scope),
    loadChannelOptions(em, scope),
    loadTierThresholds(container, scope),
  ])

  // One probe for both catalogues, so the two cannot disagree about what is installed.
  const capabilities = await readCapabilities(em)

  return NextResponse.json({
    triggers: triggerCatalogFor(capabilities).map((entry) => ({
      eventId: entry.eventId,
      labelKey: entry.labelKey,
      available: entry.available,
      blockedReasonKey: entry.blockedReasonKey ?? null,
      contextKeys: entry.contextKeys,
    })),
    // What a SCHEDULED campaign can iterate over. Without this the canvas could only author event
    // triggers, which left every periodic campaign — win-back, review requests — API-only.
    // Narrowed by what this installation can read, so a source whose module is not installed arrives
    // unavailable WITH a reason rather than as a row that silently never produces anybody.
    sweepSources: sweepSourceCatalog(capabilities),
    contentBlocks,
    segments,
    /**
     * What an audience may ask about, and what each question's answer looks like.
     *
     * Authoring an audience used to mean typing a dot-path into a text box and JSON into another. The
     * catalogue is served rather than bundled for the same reason the trigger labels are: it is one list
     * that the screen renders and the tests can read, and it stays the single place a field becomes
     * targetable.
     */
    audienceFields: AUDIENCE_FIELDS,
    audienceOptions: {
      segments: segments.map((segment) => ({ value: segment.slug, label: segment.name })),
      tags,
      categories,
      channels,
      tiers: tierThresholds.map((tier) => ({ value: tier.key, label: tier.key })),
      // The languages this installation actually serves, so a per-language campaign offers the ones whose
      // copy can exist rather than every language there is.
      locales: getSupportedLocales().map((locale) => ({ value: locale, label: locale })),
    },
    steps: listMarketingSteps().map((step) => ({
      type: step.type,
      labelKey: step.labelKey,
      descriptionKey: step.descriptionKey ?? null,
      icon: step.icon ?? null,
      channel: step.channel ?? null,
      uiFields: step.uiFields,
    })),
  })
}

export const openApi = {
  GET: {
    summary: 'List available campaign triggers, sweep sources and step types',
    description: 'Drives the canvas palette and inspector. Derived from the live registries, so a third-party step type or sweep source appears automatically.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'Triggers and step types with their UI metadata' } },
  },
}
