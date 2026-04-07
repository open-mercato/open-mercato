/** @jest-environment jsdom */

jest.mock('@open-mercato/shared/lib/phone', () => ({
  extractPhoneDigits: (value: string | null | undefined) => {
    if (typeof value !== 'string') return ''
    const matches = value.match(/\d+/g)
    return matches ? matches.join('') : ''
  },
  validatePhoneNumber: (value: string | null | undefined) => {
    if (typeof value !== 'string') return { valid: true, normalized: null, digits: '', reason: null }
    const normalized = value.trim()
    if (!normalized) return { valid: true, normalized: null, digits: '', reason: null }
    const digits = normalized.replace(/\D/g, '')
    const valid = normalized.startsWith('+') && digits.length >= 7 && digits.length <= 15 && /^[+\d\s\-().]+$/.test(normalized)
    return { valid, normalized, digits, reason: valid ? null : 'invalid' }
  },
}))

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { PhoneNumberField } from '../PhoneNumberField'

function PhoneFieldHarness(props: Partial<React.ComponentProps<typeof PhoneNumberField>>) {
  const [value, setValue] = React.useState<string | undefined>(undefined)

  return (
    <div>
      <PhoneNumberField value={value} onValueChange={setValue} {...props} />
      <output data-testid="value">{value ?? ''}</output>
    </div>
  )
}

describe('PhoneNumberField', () => {
  it('keeps invalid input and shows the provided invalid label on blur', () => {
    render(<PhoneFieldHarness invalidLabel="Use an international phone number." />)

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '12345' } })
    fireEvent.blur(input)

    expect(input).toHaveValue('12345')
    expect(screen.getByText('Use an international phone number.')).toBeInTheDocument()
    expect(screen.getByTestId('value')).toHaveTextContent('12345')
  })

  it('trims and persists a valid phone number on blur', () => {
    render(<PhoneFieldHarness invalidLabel="Use an international phone number." />)

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '  +48 123 456 789  ' } })
    fireEvent.blur(input)

    expect(input).toHaveValue('+48 123 456 789')
    expect(screen.getByTestId('value')).toHaveTextContent('+48 123 456 789')
    expect(screen.queryByText('Use an international phone number.')).not.toBeInTheDocument()
  })

  it('hides the blur-time validation hint when an external field error is present', () => {
    render(
      <PhoneFieldHarness
        invalidLabel="Use an international phone number."
        externalError="Use an international phone number."
      />,
    )

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '12345' } })
    fireEvent.blur(input)

    expect(screen.queryByText('Use an international phone number.')).not.toBeInTheDocument()
  })
})
