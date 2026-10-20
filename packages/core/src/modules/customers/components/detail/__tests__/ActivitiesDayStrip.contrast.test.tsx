/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { ActivitiesDayStrip } from '../ActivitiesDayStrip'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: jest.fn(async () => ({ items: [] })),
}))

// The selected day card sits on the inverse surface (`bg-foreground`). Its day
// name and caption kept the muted text token meant for the normal surface, which
// measured 3.99:1 in the light theme and 2.47:1 in the dark theme at 11 px.
describe('ActivitiesDayStrip — text on the selected day card', () => {
  const selectedDate = (() => {
    const date = new Date()
    date.setHours(10, 0, 0, 0)
    return date
  })()

  async function renderStrip() {
    renderWithProviders(
      <ActivitiesDayStrip entityId="person-1" selectedDate={selectedDate} onSelectDate={() => {}} refreshKey={0} />,
    )
    const cards = await screen.findAllByRole('button', { pressed: false })
    const selected = screen.getByRole('button', { pressed: true })
    return { selected, other: cards[0] }
  }

  const captions = (card: HTMLElement) => [card.firstElementChild, card.lastElementChild] as HTMLElement[]

  it('uses the inverse text token for the day name and caption of the selected card', async () => {
    const { selected } = await renderStrip()

    expect(selected.className).toContain('bg-foreground')
    for (const caption of captions(selected)) {
      expect(caption.className).not.toMatch(/(^|\s)text-muted-foreground(\s|$)/)
      expect(caption.className).toContain('text-background/70')
    }
  })

  it('keeps the muted text token on cards that are not selected', async () => {
    const { other } = await renderStrip()

    for (const caption of captions(other)) {
      expect(caption.className).toMatch(/(^|\s)text-muted-foreground(\s|$)/)
    }
  })
})
