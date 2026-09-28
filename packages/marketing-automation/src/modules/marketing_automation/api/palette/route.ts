import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { listMarketingSteps } from '../../lib/engine/registry.js'
import { TRIGGER_CATALOG } from '../../lib/trigger-catalog.js'
import { sweepSourceCatalog } from '../../lib/sweep-sources.js'

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
    return NextResponse.json({ triggers: [], steps: [], sweepSources: [] }, { status: 401 })
  }

  return NextResponse.json({
    triggers: TRIGGER_CATALOG.map((entry) => ({
      eventId: entry.eventId,
      labelKey: entry.labelKey,
      available: entry.available,
      blockedReasonKey: entry.blockedReasonKey ?? null,
      contextKeys: entry.contextKeys,
    })),
    // What a SCHEDULED campaign can iterate over. Without this the canvas could only author event
    // triggers, which left every periodic campaign — win-back, review requests — API-only.
    sweepSources: sweepSourceCatalog(),
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
