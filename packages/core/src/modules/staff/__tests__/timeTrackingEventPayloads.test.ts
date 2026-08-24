/**
 * The webhook and browser contract for the `staff.timesheets.*` family.
 *
 * Outbound webhook delivery is registration-free — `packages/webhooks` subscribes
 * with `event: '*'` and matches each id against a webhook's subscribed patterns — so
 * nothing in the webhooks package fails when a time-tracking event is undeliverable.
 * Two things decide whether it is, and both are pinned here: the id must carry a
 * payload contract, and that payload must carry `tenantId` (the dispatcher drops
 * anything without one before it ever looks for an endpoint).
 *
 * The browser side is pinned beside it: an event marked `clientBroadcast: true`
 * reaches every user of the organization with no feature check, so no such payload
 * may declare a rate, a cost or an amount — money is gated on
 * `staff.timesheets.rates.view`, which SSE cannot apply.
 */

import { z } from 'zod'
import { eventsConfig } from '../events'
import {
  staffTimeTrackingEventPayloadSchemas,
  type StaffTimeTrackingEventId,
} from '../events.payloads'

const TIME_TRACKING_PREFIX = 'staff.timesheets.'

const declaredTimeTrackingIds = eventsConfig.events
  .map((event) => event.id)
  .filter((id) => id.startsWith(TIME_TRACKING_PREFIX))

const schemaIds = Object.keys(staffTimeTrackingEventPayloadSchemas) as StaffTimeTrackingEventId[]

const MONEY_FIELD_PATTERN = /rate|cost|amount/i

describe('staff.timesheets.* webhook payload contracts', () => {
  it('covers every declared time-tracking event id', () => {
    expect([...schemaIds].sort()).toEqual([...declaredTimeTrackingIds].sort())
  })

  it.each(schemaIds)('requires tenantId on %s', (eventId) => {
    const schema = staffTimeTrackingEventPayloadSchemas[eventId]
    expect(schema.safeParse({ organizationId: 'org' }).success).toBe(false)
  })

  it('is reachable by the outbound dispatcher', () => {
    // `shouldSkipOutboundDispatch` drops `webhooks.*`, `application.*`, `query_index.*`
    // and anything flagged `excludeFromTriggers`.
    for (const event of eventsConfig.events) {
      if (!event.id.startsWith(TIME_TRACKING_PREFIX)) continue
      expect(event.id.startsWith('webhooks.')).toBe(false)
      expect(event.id.startsWith('application.')).toBe(false)
      expect(event.id.startsWith('query_index.')).toBe(false)
      expect(event.excludeFromTriggers ?? false).toBe(false)
    }
  })
})

describe('clientBroadcast payloads carry no money', () => {
  const broadcastIds = eventsConfig.events
    .filter((event) => event.id.startsWith(TIME_TRACKING_PREFIX) && event.clientBroadcast === true)
    .map((event) => event.id as StaffTimeTrackingEventId)

  it('marks the real-time surfaces as broadcast', () => {
    expect([...broadcastIds].sort()).toEqual(
      [
        'staff.timesheets.time_entry.created',
        'staff.timesheets.time_entry.deleted',
        'staff.timesheets.time_entry.timer_started',
        'staff.timesheets.time_entry.timer_stopped',
        'staff.timesheets.time_entry.updated',
        'staff.timesheets.time_project.budget_threshold_reached',
        'staff.timesheets.time_report.closed',
        'staff.timesheets.time_report.unlocked',
        'staff.timesheets.time_task.status_changed',
      ].sort(),
    )
  })

  it.each(broadcastIds)('declares no required money field on %s', (eventId) => {
    const schema = staffTimeTrackingEventPayloadSchemas[eventId] as z.ZodObject<z.ZodRawShape>
    const required = Object.entries(schema.shape)
      .filter(([, field]) => !(field as z.ZodTypeAny).isOptional())
      .map(([key]) => key)
    expect(required.filter((key) => MONEY_FIELD_PATTERN.test(key))).toEqual([])
  })
})
