/**
 * @jest-environment jsdom
 */
// US-D2 / screen 9 note 1: the duration field must never eat what the user
// typed. Unparseable text stays in the input, the field goes invalid, and the
// message lists the accepted formats instead of saying "invalid value".
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { DurationInput, formatTrimmedDecimalDuration, type DurationInputState } from '../DurationInput'
import { formatDuration } from '../../time-tracking/duration'

const mockTranslate = (_key: string, fallback?: string) => fallback ?? ''

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
}))

const HINT = 'Understands 1h 40m, 1.5h, 90m, 1:40.'
const PARSE_ERROR = "I don't understand that format. Try 1h 40m, 1.5h, 90m or 1:40."

type HarnessProps = {
  initial?: number | null
  onChange?: (minutes: number | null, state: DurationInputState) => void
  variant?: 'default' | 'compact'
  formatValue?: (minutes: number) => string
}

function Harness({ initial = null, onChange, variant, formatValue }: HarnessProps) {
  const [value, setValue] = React.useState<number | null>(initial)
  return (
    <DurationInput
      value={value}
      variant={variant}
      formatValue={formatValue}
      ariaLabel="Duration"
      onChange={(minutes, state) => {
        setValue(minutes)
        onChange?.(minutes, state)
      }}
    />
  )
}

function getInput(): HTMLInputElement {
  return screen.getByLabelText('Duration') as HTMLInputElement
}

describe('DurationInput', () => {
  it.each([
    ['1h 40m', 100],
    ['1h40m', 100],
    ['1.5h', 90],
    ['90m', 90],
    ['1:40', 100],
    ['1.5', 90],
    ['1,5', 90],
  ])('parses %s into %i minutes', (typed, minutes) => {
    const onChange = jest.fn()
    render(<Harness onChange={onChange} />)

    fireEvent.change(getInput(), { target: { value: typed } })

    expect(onChange).toHaveBeenCalledWith(minutes, expect.objectContaining({ status: 'valid', raw: typed }))
  })

  it('keeps unparseable text in the field and reports it as invalid', () => {
    const onChange = jest.fn()
    render(<Harness onChange={onChange} />)
    const input = getInput()

    fireEvent.change(input, { target: { value: '1godz i troche' } })

    expect(input.value).toBe('1godz i troche')
    expect(onChange).toHaveBeenCalledWith(null, expect.objectContaining({ status: 'invalid' }))
    expect(input.getAttribute('aria-invalid')).toBe('true')

    const message = screen.getByRole('alert')
    expect(input.getAttribute('aria-describedby')).toBe(message.getAttribute('id'))
  })

  it('names the accepted formats instead of saying the value is invalid', () => {
    render(<Harness />)

    fireEvent.change(getInput(), { target: { value: 'nonsense' } })

    const message = screen.getByRole('alert').textContent ?? ''
    expect(message).toBe(PARSE_ERROR)
    expect(message).toContain('1h 40m')
    expect(message).toContain('1.5h')
    expect(message).toContain('90m')
    expect(message).toContain('1:40')
  })

  it('does not rewrite unparseable text on blur', () => {
    render(<Harness />)
    const input = getInput()

    fireEvent.change(input, { target: { value: '1godz i troche' } })
    fireEvent.focusOut(input, { target: { value: '1godz i troche' } })

    expect(input.value).toBe('1godz i troche')
    expect(screen.getByRole('alert').textContent).toBe(PARSE_ERROR)
  })

  it('normalises valid input on blur', () => {
    render(<Harness />)
    const input = getInput()

    fireEvent.change(input, { target: { value: '90m' } })
    expect(input.value).toBe('90m')

    fireEvent.focusOut(input, { target: { value: '90m' } })
    expect(input.value).toBe('1h 30m')
  })

  it('treats a cleared field as empty rather than an error', () => {
    const onChange = jest.fn()
    render(<Harness initial={90} onChange={onChange} />)
    const input = getInput()

    fireEvent.change(input, { target: { value: '' } })

    expect(onChange).toHaveBeenCalledWith(null, expect.objectContaining({ status: 'empty' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(input.getAttribute('aria-invalid')).toBe('false')
    expect(screen.getByText(HINT)).toBeTruthy()

    fireEvent.focusOut(input, { target: { value: '' } })
    expect(input.value).toBe('')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows the format hint while nothing is wrong', () => {
    render(<Harness initial={100} />)

    expect(getInput().value).toBe('1h 40m')
    expect(screen.getByText(HINT)).toBeTruthy()
  })

  it('reports the status transition to onStatusChange', () => {
    const onStatusChange = jest.fn()
    render(
      <DurationInput value={null} ariaLabel="Duration" onChange={jest.fn()} onStatusChange={onStatusChange} />,
    )

    fireEvent.change(getInput(), { target: { value: 'zzz' } })

    expect(onStatusChange).toHaveBeenCalledWith(expect.objectContaining({ status: 'empty' }))
    expect(onStatusChange).toHaveBeenCalledWith(expect.objectContaining({ status: 'invalid', minutes: null }))
  })

  it('renders the compact variant without the hint and surfaces the error as a title', () => {
    render(<Harness variant="compact" />)
    const input = getInput()

    expect(screen.queryByText(HINT)).toBeNull()

    fireEvent.change(input, { target: { value: 'zzz' } })

    expect(input.value).toBe('zzz')
    expect(input.getAttribute('title')).toBe(PARSE_ERROR)
    expect(input.getAttribute('aria-invalid')).toBe('true')
    const message = screen.getByRole('alert')
    expect(message.className).toContain('sr-only')
    expect(input.getAttribute('aria-describedby')).toBe(message.getAttribute('id'))
  })

  // W3: the grid shows `2`, not `2.00`. Phase 5 swaps it onto this component,
  // so the component must be able to reproduce that exact look.
  it('reproduces the timesheet grid look through formatValue', () => {
    expect(formatDuration(120, 'decimal')).toBe('2.00')
    expect(formatTrimmedDecimalDuration(120)).toBe('2')
    expect(formatTrimmedDecimalDuration(90)).toBe('1.5')
    expect(formatTrimmedDecimalDuration(100)).toBe('1.67')
    expect(formatTrimmedDecimalDuration(0)).toBe('')

    render(<Harness initial={120} formatValue={formatTrimmedDecimalDuration} />)

    expect(getInput().value).toBe('2')
  })

  it('honours the display style when no formatter is given', () => {
    render(<DurationInput value={100} displayStyle="clock" ariaLabel="Duration" onChange={jest.fn()} />)

    expect(getInput().value).toBe('1:40')
  })
})
