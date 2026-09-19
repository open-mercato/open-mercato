/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { US_DISPLAY_TEMPLATE, EU_DISPLAY_TEMPLATE } from '@open-mercato/shared/lib/display/templates'
import type { DisplayProfile } from '@open-mercato/shared/lib/display/profile'
import type { PackageDimension } from '../types'

let activeProfile: DisplayProfile | null = null

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string, params?: Record<string, string | number>) => {
    const template = fallback ?? _key
    if (!params) return template
    return Object.entries(params).reduce((acc, [key, value]) => acc.replace(`{${key}}`, String(value)), template)
  },
}))

jest.mock('@open-mercato/ui/backend/markets/MarketProfileProvider', () => ({
  useDisplayProfile: () => activeProfile,
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PackageEditor } = require('../components/PackageEditor')

const METRIC_PACKAGE: PackageDimension = { weightKg: 1, lengthCm: 20, widthCm: 15, heightCm: 10 }

function renderEditor(onChange: (next: PackageDimension[]) => void) {
  return render(
    React.createElement(PackageEditor, { packages: [METRIC_PACKAGE], onChange, disabled: false }),
  )
}

describe('PackageEditor under a US market', () => {
  afterEach(() => { activeProfile = null })

  it('labels the fields in pounds and inches and shows the converted values', () => {
    activeProfile = US_DISPLAY_TEMPLATE
    renderEditor(() => {})

    expect(screen.getByText('Weight (lb)')).toBeTruthy()
    expect(screen.getByText('Length (in)')).toBeTruthy()

    const inputs = screen.getAllByRole('spinbutton') as HTMLInputElement[]
    // 1 kg is 2.2 lb, 20 cm is 7.87 in, both rounded to two decimals for the input.
    expect(inputs[0].value).toBe('2.2')
    expect(inputs[1].value).toBe('7.87')
  })

  it('converts what the merchant types back into the metric contract', () => {
    activeProfile = US_DISPLAY_TEMPLATE
    const onChange = jest.fn()
    renderEditor(onChange)

    const inputs = screen.getAllByRole('spinbutton') as HTMLInputElement[]
    fireEvent.change(inputs[0], { target: { value: '10' } })

    expect(onChange).toHaveBeenCalledTimes(1)
    const [next] = onChange.mock.calls[0] as [PackageDimension[]]
    // 10 lb is 4.5359237 kg; the payload the carrier adapter receives stays metric.
    expect(next[0].weightKg).toBeCloseTo(4.5359237, 6)
  })
})

describe('PackageEditor without a US market', () => {
  afterEach(() => { activeProfile = null })

  it('keeps kilograms and centimetres for a metric market', () => {
    activeProfile = EU_DISPLAY_TEMPLATE
    renderEditor(() => {})

    expect(screen.getByText('Weight (kg)')).toBeTruthy()
    const inputs = screen.getAllByRole('spinbutton') as HTMLInputElement[]
    expect(inputs[0].value).toBe('1')
  })

  it('keeps kilograms and centimetres when no market was picked at all', () => {
    activeProfile = null
    const onChange = jest.fn()
    renderEditor(onChange)

    expect(screen.getByText('Weight (kg)')).toBeTruthy()
    const inputs = screen.getAllByRole('spinbutton') as HTMLInputElement[]
    expect(inputs[0].value).toBe('1')

    fireEvent.change(inputs[0], { target: { value: '3' } })
    const [next] = onChange.mock.calls[0] as [PackageDimension[]]
    expect(next[0].weightKg).toBe(3)
  })
})
