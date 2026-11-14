/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { FooterFields } from '../FooterFields'

describe('FooterFields — Reminder option labels (formatReminderLabel)', () => {
  function renderReminder(reminderMinutes: number) {
    return renderWithProviders(
      <FooterFields
        visible={new Set(['reminder', 'visibility'])}
        activityType="meeting"
        reminderMinutes={reminderMinutes}
        setReminderMinutes={() => {}}
        visibility="team"
        setVisibility={() => {}}
      />,
    )
  }

  function reminderTrigger(): HTMLElement {
    // The reminder DS Select renders first; visibility second.
    return screen.getAllByRole('combobox')[0]
  }

  it.each([
    [0, 'None'],
    [5, '5 min before'],
    [10, '10 min before'],
    [15, '15 min before'],
    [30, '30 min before'],
    [60, '1 hour before'],
    [240, '4 hours before'],
    [1440, '1 day before'],
  ])('renders the human-readable label for %i minutes', (minutes, label) => {
    const { unmount } = renderReminder(minutes as number)
    expect(reminderTrigger()).toHaveTextContent(label as string)
    unmount()
  })

  it('selects the matching option for the per-type default 1440 (1 day)', () => {
    renderReminder(1440)
    expect(reminderTrigger()).toHaveTextContent('1 day before')
  })

  it('selects the call default 5 minutes before', () => {
    renderReminder(5)
    expect(reminderTrigger()).toHaveTextContent('5 min before')
  })

  it('renders None for the 0 sentinel', () => {
    renderReminder(0)
    expect(reminderTrigger()).toHaveTextContent('None')
  })
})
