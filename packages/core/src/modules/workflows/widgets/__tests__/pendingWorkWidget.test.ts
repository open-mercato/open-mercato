/**
 * The generic "pending work" record-page widget (spec §6.2, §2.1).
 *
 * Two things are pinned here, and both are about honesty:
 *
 * 1. **The spot list is enumerated, not universal.** There is NO generic
 *    record-page spot id in this platform — every one is per-entity — so this
 *    test reads the injection table and asserts the exact set that is wired.
 *    A future page must be added deliberately, and a removed one must break a
 *    test rather than silently stop rendering.
 * 2. **The order detail page must not double up.** The specialized
 *    `order-approval` widget completes the approval in place; the generic panel
 *    can only link to it. They therefore live on DIFFERENT order spots.
 */

import { describe, test, expect } from '@jest/globals'
import { injectionTable } from '../injection-table'
import pendingWorkWidget from '../injection/pending-work/widget'
import orderApprovalWidget from '../injection/order-approval/widget'

type Slot = { widgetId: string; kind?: string; priority?: number }

function widgetIdsAt(spotId: string): string[] {
  const slots = injectionTable[spotId]
  if (!slots) return []
  const list = Array.isArray(slots) ? slots : [slots]
  return list.map((slot) => (typeof slot === 'string' ? slot : (slot as Slot).widgetId))
}

describe('pending-work widget metadata', () => {
  test('declares a stable id and stays enabled', () => {
    expect(pendingWorkWidget.metadata.id).toBe('workflows.injection.pending-work')
    expect(pendingWorkWidget.metadata.enabled).toBe(true)
    expect(typeof pendingWorkWidget.Widget).toBe('function')
  })

  /**
   * Empty on purpose (briefing §3c): visibility comes from the work-inbox
   * query's own tenant/organization scoping, not from a workflows grant.
   * Gating it would hide a person's own approval unless an administrator
   * granted a workflows feature to every frontline role.
   */
  test('carries no feature gate', () => {
    expect(pendingWorkWidget.metadata.features).toEqual([])
  })
})

describe('record-page coverage', () => {
  test('is wired into exactly the spots this change enumerates', () => {
    const wired = Object.keys(injectionTable).filter((spotId) =>
      widgetIdsAt(spotId).includes('workflows.injection.pending-work'),
    )
    expect(wired.sort()).toEqual([
      'detail:customers.company:footer',
      'detail:customers.deal:footer',
      'detail:customers.person:footer',
      'sales.document.detail.order:tabs',
    ])
  })

  test('every wired spot is a real record-detail spot id, not an invented one', () => {
    // `detail:<module>.<entity>:<slot>` is the convention; the sales document
    // detail page predates it and uses its own prefix.
    for (const spotId of Object.keys(injectionTable)) {
      if (!widgetIdsAt(spotId).includes('workflows.injection.pending-work')) continue
      expect(
        spotId.startsWith('detail:') || spotId.startsWith('sales.document.detail.'),
      ).toBe(true)
    }
  })
})

describe('the order-approval widget is not regressed', () => {
  test('keeps its own spot, gate and inline behaviour', () => {
    expect(widgetIdsAt('sales.document.detail.order:details')).toEqual([
      orderApprovalWidget.metadata.id,
    ])
    expect(orderApprovalWidget.metadata.features).toEqual(['sales.orders.approve'])
  })

  test('never shares a spot with the generic panel', () => {
    for (const spotId of Object.keys(injectionTable)) {
      const ids = widgetIdsAt(spotId)
      const bothPresent =
        ids.includes(orderApprovalWidget.metadata.id) &&
        ids.includes('workflows.injection.pending-work')
      expect(bothPresent).toBe(false)
    }
  })
})
