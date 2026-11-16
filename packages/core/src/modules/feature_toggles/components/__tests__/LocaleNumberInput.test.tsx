/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { assertNumberInputParsed, isUnparsedNumberInput, LocaleNumberInput } from '../LocaleNumberInput'

function Harness({ locale, initial }: { locale: string; initial: unknown }) {
  const [value, setValue] = React.useState<unknown>(initial)
  return (
    <I18nProvider locale={locale} dict={{}}>
      <LocaleNumberInput value={value} onValueChange={setValue} />
      <output data-testid="stored">{String(value)}</output>
    </I18nProvider>
  )
}

function typeSequentially(input: HTMLElement, text: string) {
  let typed = ''
  for (const char of text) {
    typed += char
    fireEvent.change(input, { target: { value: typed } })
  }
}

describe('LocaleNumberInput', () => {
  it('keeps a Polish decimal comma while typing and stores the decimal value (QA FT9256-02)', () => {
    render(<Harness locale="pl" initial={0} />)
    const input = screen.getByRole('textbox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '' } })
    typeSequentially(input, '12,5')
    expect((input as HTMLInputElement).value).toBe('12,5')
    expect(screen.getByTestId('stored').textContent).toBe('12.5')
  })

  it('redisplays a stored decimal with the locale separator', () => {
    render(<Harness locale="pl" initial={2.5} />)
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('2,5')
  })

  it('accepts a dot under an English locale', () => {
    render(<Harness locale="en" initial={0} />)
    const input = screen.getByRole('textbox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '42.75' } })
    expect(screen.getByTestId('stored').textContent).toBe('42.75')
  })

  it('keeps unparseable text on screen and in form state instead of storing 0 (QA #9369 rows 4 and 8)', () => {
    render(<Harness locale="pl" initial={7} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'abc' } })
    expect(screen.getByTestId('stored').textContent).toBe('abc')
    fireEvent.blur(input)
    expect(input.value).toBe('abc')
  })

  it('keeps a cleared field empty after blur (QA #9369 row 5)', () => {
    render(<Harness locale="pl" initial={7} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(input.value).toBe('')
    expect(screen.getByTestId('stored').textContent).toBe('')
  })

  it('turns off autofill and spellcheck like the CrudForm number input', () => {
    render(<Harness locale="pl" initial={1} />)
    const input = screen.getByRole('textbox')
    expect(input).toHaveAttribute('autocomplete', 'off')
    expect(input).toHaveAttribute('spellcheck', 'false')
  })

  it('reads a numeric string as its number', () => {
    render(<Harness locale="pl" initial="42.5" />)
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('42,5')
  })

  it.each([null, true])('shows 0 for a non-numeric value %p', (initial) => {
    render(<Harness locale="pl" initial={initial} />)
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('0')
  })

  it.each([
    ['ArrowUp', '8,2', '9,2', '9.2'],
    ['ArrowDown', '8,2', '7,2', '7.2'],
  ])('%s steps the value by one with the locale separator', (key, typed, shown, stored) => {
    render(<Harness locale="pl" initial={0} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: typed } })
    fireEvent.keyDown(input, { key })
    expect(input.value).toBe(shown)
    expect(screen.getByTestId('stored').textContent).toBe(stored)
  })

  it('steps the stored value without any typing', () => {
    render(<Harness locale="en" initial={3} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(input.value).toBe('4')
    expect(screen.getByTestId('stored').textContent).toBe('4')
  })

  it('shows 0 when no number is set yet', () => {
    render(<Harness locale="pl" initial={null} />)
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('0')
  })
})

describe('assertNumberInputParsed', () => {
  const t = (_key: string, fallback: string) => fallback

  it.each([0, 12.5, -3, '42.5', null, undefined])('lets %p through', (value) => {
    expect(isUnparsedNumberInput(value)).toBe(false)
    expect(() => assertNumberInputParsed(value, 'defaultValue', t)).not.toThrow()
  })

  it.each(['abc', '', '   ', '12,5x'])('refuses %p with a field error on the given field', (value) => {
    expect(isUnparsedNumberInput(value)).toBe(true)
    let thrown: unknown
    try {
      assertNumberInputParsed(value, 'overrideValue', t)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toMatchObject({ fieldErrors: { overrideValue: 'Enter a valid number.' } })
  })
})
