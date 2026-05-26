/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { InlineActivityComposer } from '../InlineActivityComposer'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: jest.fn(async () => ({})),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('../MiniWeekCalendar', () => ({
  MiniWeekCalendar: () => <div data-testid="mini-week-calendar">mini-week-calendar</div>,
}))

describe('InlineActivityComposer', () => {
  beforeEach(() => {
    localStorage.clear()
    jest.clearAllMocks()
  })

  it('renders a 3-row autosize description textarea with an explicit label', () => {
    renderWithProviders(
      <InlineActivityComposer entityType="person" entityId="person-1" />,
    )

    const textarea = screen.getByRole('textbox', {
      name: /Description/i,
    }) as HTMLTextAreaElement
    expect(textarea).toBeInTheDocument()
    expect(textarea.rows).toBe(3)
    expect(textarea.className).toEqual(expect.stringContaining('min-h-[72px]'))
    expect(textarea.className).toEqual(expect.stringContaining('resize-none'))
  })

  it('shows the MiniWeekCalendar by default (hideWeekPreview=false)', () => {
    renderWithProviders(
      <InlineActivityComposer entityType="person" entityId="person-1" />,
    )
    expect(screen.getByTestId('mini-week-calendar')).toBeInTheDocument()
    // Toggle button must expose "hide" action because the calendar is visible.
    expect(
      screen.getByRole('button', { name: /Hide week preview/i }),
    ).toBeInTheDocument()
  })

  it('toggles the week preview off and persists the choice under the per-entity-kind key', () => {
    renderWithProviders(
      <InlineActivityComposer entityType="person" entityId="person-1" />,
    )

    const hideBtn = screen.getByRole('button', { name: /Hide week preview/i })
    act(() => {
      fireEvent.click(hideBtn)
    })

    // After toggling, calendar is unmounted and the button flips to "show".
    expect(screen.queryByTestId('mini-week-calendar')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Show week preview/i }),
    ).toBeInTheDocument()

    // Persistence goes through `usePersistedBooleanFlag` under the entity-type
    // keyed localStorage slot so the preference survives refreshes and follows
    // the user to other records of the same kind (company/person/deal).
    expect(localStorage.getItem('om:inline-composer:week-preview:person')).toBe(
      JSON.stringify('1'),
    )
  })

  it('stores the preference under a distinct key for each entity type', () => {
    const { rerender } = renderWithProviders(
      <InlineActivityComposer entityType="company" entityId="company-1" />,
    )
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Hide week preview/i }))
    })
    expect(localStorage.getItem('om:inline-composer:week-preview:company')).toBe(
      JSON.stringify('1'),
    )

    rerender(<InlineActivityComposer entityType="deal" entityId="deal-1" />)
    // The deal-keyed preference is independent from the company one.
    expect(localStorage.getItem('om:inline-composer:week-preview:deal')).toBeNull()
    expect(screen.getByTestId('mini-week-calendar')).toBeInTheDocument()
  })
})
