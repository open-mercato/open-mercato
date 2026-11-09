/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { resolveDateLocaleSettings } from '@open-mercato/shared/lib/date-locale/resolve'
import { setClientDateLocaleSettings } from '@open-mercato/ui/primitives/date-locale-store'
import { ActivitiesDayStrip } from '../ActivitiesDayStrip'
import type { InteractionSummary } from '../types'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: jest.fn(async () => ({ items: [] })),
}))

const noEnv = { locale: null, dateFormat: null, dateTimeFormat: null, timeFormat: null, timeZone: null, firstDayOfWeek: null }

function meeting(scheduledAt: string, duration: number): InteractionSummary {
  return {
    id: 'act-tz',
    interactionType: 'meeting',
    title: 'Tokyo standup',
    body: null,
    status: 'planned',
    scheduledAt,
    occurredAt: null,
    priority: null,
    authorUserId: null,
    ownerUserId: null,
    appearanceIcon: null,
    appearanceColor: null,
    source: null,
    entityId: 'entity-1',
    dealId: null,
    organizationId: null,
    tenantId: null,
    authorName: null,
    authorEmail: null,
    dealTitle: null,
    customValues: null,
    duration,
    createdAt: scheduledAt,
    updatedAt: scheduledAt,
  }
}

describe('ActivitiesDayStrip — configured display zone differs from the browser zone', () => {
  beforeEach(() => {
    setClientDateLocaleSettings(resolveDateLocaleSettings({ tenant: { timeZone: 'Asia/Tokyo' }, env: noEnv }))
  })

  afterEach(() => setClientDateLocaleSettings(null))

  it('fills the occupancy slot of a 09:00 Tokyo meeting on its Tokyo day', () => {
    renderWithProviders(
      <ActivitiesDayStrip
        entityId="person-1"
        selectedDate={new Date(2026, 6, 21)}
        onSelectDate={() => {}}
        events={[meeting('2026-07-21T00:00:00.000Z', 60)]}
      />,
    )

    const card = screen.getByRole('button', { pressed: true })
    expect(card.textContent).toContain('1 event')
    const slots = Array.from(card.querySelectorAll('div[aria-hidden="true"].shrink-0'))
    expect(slots).toHaveLength(10)
    expect(slots.map((slot) => slot.classList.contains('h-3.5'))).toEqual([
      false, true, false, false, false, false, false, false, false, false,
    ])
  })
})
