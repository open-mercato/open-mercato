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

  it('renders all reminder options with human-readable labels', () => {
    renderReminder(15)
    const reminderSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement
    const optionTexts = Array.from(reminderSelect.options).map((opt) => opt.textContent?.trim())
    expect(optionTexts).toEqual([
      'None',
      '5 min before',
      '10 min before',
      '15 min before',
      '30 min before',
      '1 hour before',
      '4 hours before',
      '1 day before',
    ])
  })

  it('selects the matching option for the per-type default 1440 (1 day)', () => {
    renderReminder(1440)
    const reminderSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement
    expect(reminderSelect.value).toBe('1440')
    const selected = Array.from(reminderSelect.options).find((opt) => opt.selected)
    expect(selected?.textContent?.trim()).toBe('1 day before')
  })

  it('selects the call default 5 minutes before', () => {
    renderReminder(5)
    const reminderSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement
    const selected = Array.from(reminderSelect.options).find((opt) => opt.selected)
    expect(selected?.textContent?.trim()).toBe('5 min before')
  })

  it('renders None for the 0 sentinel', () => {
    renderReminder(0)
    const reminderSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement
    const selected = Array.from(reminderSelect.options).find((opt) => opt.selected)
    expect(selected?.textContent?.trim()).toBe('None')
  })
})
