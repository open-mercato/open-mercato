/**
 * Events API - Returns declared events from module events.ts files
 *
 * Uses the globally registered event configs (registered during bootstrap).
 *
 * Authenticated only. The declared event registry leaks module/entity topology
 * and SSE/portal broadcast surfaces; anonymous callers must not be able to
 * enumerate it. The contract surface mirrors `packages/webhooks/.../api/events`,
 * which already gates the same data behind authentication.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { getDeclaredEvents } from '@open-mercato/shared/modules/events'

export async function GET(request: NextRequest) {
  const auth = await getAuthFromCookies()
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)

  // Optional filters
  const category = searchParams.get('category')
  const moduleId = searchParams.get('module')
  const excludeTriggerExcluded = searchParams.get('excludeTriggerExcluded') !== 'false'

  // Get events from the global registry (populated during bootstrap)
  let filteredEvents = getDeclaredEvents()

  if (excludeTriggerExcluded) {
    filteredEvents = filteredEvents.filter(e => !e.excludeFromTriggers)
  }

  if (category) {
    filteredEvents = filteredEvents.filter(e => e.category === category)
  }

  if (moduleId) {
    filteredEvents = filteredEvents.filter(e => e.module === moduleId)
  }

  return NextResponse.json({
    data: filteredEvents,
    total: filteredEvents.length,
  })
}
