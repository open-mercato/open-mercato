/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CalendarSettingsModal } from '../CalendarSettingsModal'
import { DEFAULT_CALENDAR_PREFERENCES } from '../../../lib/calendar/preferences'

describe('CalendarSettingsModal activity type management', () => {
  it('links to the authoritative manager and preserves saved preferences', () => {
    const onSave = jest.fn()
    renderWithProviders(<CalendarSettingsModal open preferences={{ ...DEFAULT_CALENDAR_PREFERENCES, activityTypes: ['meeting'], eventCategories: ['Team'] }}
      seedActivityTypes={['call']} onOpenChange={jest.fn()} onSave={onSave} />)

    expect(screen.getByRole('link', { name: 'Manage activity types' })).toHaveAttribute('href', '/backend/config/customers#customer-dictionary-activity-types')
    expect(screen.queryByRole('textbox', { name: 'Activity Types' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Event Categories' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ activityTypes: ['meeting'], eventCategories: ['Team'] }))
  })
})
