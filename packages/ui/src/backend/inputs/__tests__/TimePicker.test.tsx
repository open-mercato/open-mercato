jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))
let mockLocale: string | undefined
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
  useOptionalLocale: () => mockLocale,
}))

import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { TimePicker } from '../TimePicker'

beforeEach(() => {
  mockLocale = 'en'
})

// Note: Tests for Now/Clear button visibility and click behaviour require opening
// the Radix Popover (portal content is not rendered by renderToString when closed).
// Those tests are covered by integration tests (TC-DTP-002) post-migration.

function render(element: React.ReactElement): string {
  return renderToString(element)
}

describe('TimePicker SSR render', () => {
  it('shows placeholder text when no value', () => {
    const html = render(<TimePicker onChange={jest.fn()} placeholder="Pick a time" />)
    expect(html).toContain('Pick a time')
  })

  it('shows 12h-formatted value in trigger when value is provided (matches slot list)', () => {
    const html = render(<TimePicker value="14:30" onChange={jest.fn()} />)
    expect(html).toContain('02:30 PM')
  })

  it('shows a 24h value for a locale that writes time on a 24-hour clock', () => {
    mockLocale = 'pl'
    const html = render(<TimePicker value="14:30" onChange={jest.fn()} />)
    expect(html).toContain('14:30')
    expect(html).not.toContain('PM')
  })

  it('keeps the 12h clock for a locale that uses AM/PM', () => {
    mockLocale = 'ko'
    const html = render(<TimePicker value="14:30" onChange={jest.fn()} />)
    expect(html).toContain('02:30 PM')
  })

  it('lets an explicit format prop override the locale default', () => {
    mockLocale = 'pl'
    const html = render(<TimePicker value="14:30" onChange={jest.fn()} format="12h" />)
    expect(html).toContain('02:30 PM')
  })

  it('falls back to the 12h clock when rendered outside an i18n provider', () => {
    mockLocale = undefined
    const html = render(<TimePicker value="14:30" onChange={jest.fn()} />)
    expect(html).toContain('02:30 PM')
  })

  it('renders trigger button with aria-haspopup="dialog"', () => {
    const html = render(<TimePicker onChange={jest.fn()} />)
    expect(html).toContain('aria-haspopup="dialog"')
  })

  it('renders trigger with data-crud-focus-target for CrudForm auto-focus', () => {
    const html = render(<TimePicker onChange={jest.fn()} />)
    expect(html).toContain('data-crud-focus-target')
  })

  it('renders disabled trigger when disabled prop is true', () => {
    const html = render(<TimePicker onChange={jest.fn()} disabled />)
    expect(html).toContain('disabled')
  })

  it('shows placeholder when value is null', () => {
    const html = render(<TimePicker value={null} onChange={jest.fn()} placeholder="Pick a time" />)
    expect(html).toContain('Pick a time')
  })
})
