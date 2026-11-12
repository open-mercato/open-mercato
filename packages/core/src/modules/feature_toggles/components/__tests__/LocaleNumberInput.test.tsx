/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { LocaleNumberInput } from '../LocaleNumberInput'

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

  it('stores 0 for unparseable text and shows it once the field loses focus', () => {
    render(<Harness locale="pl" initial={7} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'abc' } })
    expect(screen.getByTestId('stored').textContent).toBe('0')
    fireEvent.blur(input)
    expect(input.value).toBe('0')
  })

  it('reads a numeric string as its number', () => {
    render(<Harness locale="pl" initial="42.5" />)
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('42,5')
  })

  it.each([null, true, 'abc'])('shows 0 for a non-numeric value %p', (initial) => {
    render(<Harness locale="pl" initial={initial} />)
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('0')
  })

  it('shows 0 when no number is set yet', () => {
    render(<Harness locale="pl" initial={null} />)
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('0')
  })
})
