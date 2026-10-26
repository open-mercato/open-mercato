/** @jest-environment jsdom */

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
  useOptionalLocale: () => undefined,
}))

jest.mock('../../../primitives/select', () => {
  const React = jest.requireActual('react')
  return {
    Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectContent: ({ children }: { children: React.ReactNode }) => <ul>{children}</ul>,
    SelectItemLeading: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
    SelectItem: ({ children, value, textValue }: { children: React.ReactNode; value: string; textValue?: string }) => (
      <li data-testid="country-option" data-value={value} data-text-value={textValue ?? ''}>
        {children}
      </li>
    ),
  }
})

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { PHONE_COUNTRIES, PhoneNumberField } from '../PhoneNumberField'

describe('PhoneNumberField country typeahead', () => {
  it('uses the country name as the searchable text of each option', () => {
    render(<PhoneNumberField value={undefined} onValueChange={() => undefined} />)

    const options = screen.getAllByTestId('country-option')
    expect(options).toHaveLength(PHONE_COUNTRIES.length)

    const poland = options.find((option) => option.getAttribute('data-value') === 'PL')
    expect(poland?.getAttribute('data-text-value')).toMatch(/^Pol/)

    for (const option of options) {
      const textValue = option.getAttribute('data-text-value') ?? ''
      expect(textValue).not.toBe('')
      expect(textValue).not.toMatch(/^[\u{1F1E6}-\u{1F1FF}+]/u)
    }
  })
})
