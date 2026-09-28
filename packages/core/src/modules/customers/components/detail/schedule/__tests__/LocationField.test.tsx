/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { LocationField } from '../LocationField'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? '',
}))

describe('LocationField', () => {
  it('associates the visible location label with its input', () => {
    render(
      <LocationField
        visible={new Set(['location'])}
        activityType="meeting"
        location=""
        setLocation={jest.fn()}
      />,
    )

    expect(screen.getByRole('textbox', { name: 'Location' })).toBeTruthy()
  })
})
