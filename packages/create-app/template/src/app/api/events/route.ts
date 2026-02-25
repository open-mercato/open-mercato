/**
 * Events API - Returns declared events from module events.ts files
 *
 * Uses the globally registered event configs (registered during bootstrap).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDeclaredEvents } from '@open-mercato/shared/modules/events'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)

  // Optional filters
  const category = searchParams.get('category')
  const module = searchParams.get('module')
  const excludeTriggerExcluded = searchParams.get('excludeTriggerExcluded') !== 'false'

  // Get events from the global registry (populated during bootstrap)
  let filteredEvents = getDeclaredEvents()

  if (excludeTriggerExcluded) {
    filteredEvents = filteredEvents.filter(e => !e.excludeFromTriggers)
  }

  if (category) {
    filteredEvents = filteredEvents.filter(e => e.category === category)
  }

  if (module) {
    filteredEvents = filteredEvents.filter(e => e.module === module)
  }

  return NextResponse.json({
    data: filteredEvents,
    total: filteredEvents.length,
  })
}
