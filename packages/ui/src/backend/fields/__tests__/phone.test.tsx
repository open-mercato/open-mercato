/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { FieldRegistry } from '../registry'
import '../phone'

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/i18n/context')
  return {
    ...actual,
    useT: () => (key: string, fallback?: string) => fallback ?? key,
  }
})

jest.mock('../../inputs/PhoneNumberField', () => ({
  PhoneNumberField: ({ id, value, onValueChange, disabled, externalError, defaultCountryIso2 }: any) => (
    <div>
      <input
        aria-label="phone"
        id={id}
        value={value}
        disabled={disabled}
        data-default-country={defaultCountryIso2 ?? ''}
        onChange={(event) => onValueChange(event.target.value || undefined)}
      />
      {externalError ? <span role="alert">{externalError}</span> : null}
    </div>
  ),
  PHONE_COUNTRIES: [
    { iso2: 'US', dialCode: '+1', label: 'United States', flag: '🇺🇸' },
    { iso2: 'PL', dialCode: '+48', label: 'Poland', flag: '🇵🇱' },
  ],
}))

jest.mock('../../../primitives/select', () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => <>{children}</>
  return {
    Select: ({ value, onValueChange, children }: any) => (
      <select data-testid="country-select" value={value} onChange={(event) => onValueChange(event.target.value)}>
        {children}
      </select>
    ),
    SelectContent: Passthrough,
    SelectItem: ({ value }: any) => <option value={value} />,
    SelectItemLeading: Passthrough,
    SelectTrigger: () => null,
    SelectValue: () => null,
  }
})

describe('phone custom field', () => {
  it('registers an input and a definition editor under the "phone" kind', () => {
    expect(FieldRegistry.getInput('phone')).toBeDefined()
    expect(FieldRegistry.getDefEditor('phone')).toBeDefined()
  })

  it('wraps PhoneNumberField and forwards the configured default country', () => {
    const input = FieldRegistry.getInput('phone')
    if (!input) throw new Error('phone input not registered')
    const setValue = jest.fn()
    render(
      <>{input({ id: 'cf_work_phone', value: '+1 212 555 1234', setValue, def: { defaultCountryIso2: 'PL' } } as any)}</>,
    )

    const field = screen.getByLabelText('phone') as HTMLInputElement
    expect(field.value).toBe('+1 212 555 1234')
    expect(field).toHaveAttribute('data-default-country', 'PL')

    fireEvent.change(field, { target: { value: '+48 600 700 800' } })
    expect(setValue).toHaveBeenCalledWith('+48 600 700 800')

    fireEvent.change(field, { target: { value: '' } })
    expect(setValue).toHaveBeenCalledWith(undefined)
  })

  it('emits the selected default country from the definition editor', () => {
    const defEditor = FieldRegistry.getDefEditor('phone')
    if (!defEditor) throw new Error('phone defEditor not registered')
    const onChange = jest.fn()
    render(<>{defEditor({ def: { configJson: {} }, onChange })}</>)

    const select = screen.getByTestId('country-select') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'PL' } })
    expect(onChange).toHaveBeenCalledWith({ defaultCountryIso2: 'PL' })
  })

  it('clears the default country when auto-detect is chosen', () => {
    const defEditor = FieldRegistry.getDefEditor('phone')
    if (!defEditor) throw new Error('phone defEditor not registered')
    const onChange = jest.fn()
    render(<>{defEditor({ def: { configJson: { defaultCountryIso2: 'PL' } }, onChange })}</>)

    const select = screen.getByTestId('country-select') as HTMLSelectElement
    fireEvent.change(select, { target: { value: '__om_phone_auto__' } })
    expect(onChange).toHaveBeenCalledWith({ defaultCountryIso2: undefined })
  })
})
