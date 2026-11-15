/**
 * @jest-environment jsdom
 *
 * Regression test for issue #6313: a single unit conversion row rendered two preview lines —
 * the per-row preview formatted the factor with a hard-coded dot, and a second summary line
 * under the conversion list echoed the raw typed text — so `2,75` showed up both as
 * "2.75" and "2,75". Each row now renders exactly one preview, formatted for the active locale.
 */
import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { BASE_INITIAL_VALUES, createProductUnitConversionDraft } from '../productForm'

let mockLocale = 'pl-PL'

jest.mock('lucide-react', () => {
  const IconStub = () => null
  return new Proxy(
    { __esModule: true },
    { get: (target, prop) => (prop in target ? (target as Record<string | symbol, unknown>)[prop] : IconStub) },
  )
})

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: unknown, params?: Record<string, unknown>) => {
    const template = typeof fallback === 'string' ? fallback : key
    return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(params?.[name] ?? ''))
  },
  useLocale: () => mockLocale,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: async () => ({ ok: true, result: { entries: [] } }),
}))

jest.mock('../hooks/useUnitPriceDisplayEnabled', () => ({
  useUnitPriceDisplayEnabled: () => ({ enabled: false, isLoading: false }),
}))

import { ProductUomSection } from '../ProductUomSection'

function renderSection() {
  function Harness() {
    const [values, setValues] = React.useState({
      ...BASE_INITIAL_VALUES,
      defaultUnit: 'pc',
      unitConversions: [createProductUnitConversionDraft({ unitCode: 'km', toBaseFactor: '' })],
    })
    const handleSetValue = (id: string, next: unknown) => {
      setValues((current) => ({ ...current, [id]: next }))
    }
    return <ProductUomSection values={values} errors={{}} setValue={handleSetValue} />
  }
  render(<Harness />)
  return document.querySelector('[id^="catalog-product-uom-conversion-factor-"]') as HTMLInputElement
}

describe('ProductUomSection conversion preview (issue #6313)', () => {
  afterEach(() => {
    mockLocale = 'pl-PL'
  })

  it('renders one preview line per conversion row, formatted with the locale decimal separator', () => {
    mockLocale = 'pl-PL'
    const input = renderSection()
    fireEvent.change(input, { target: { value: '2,75' } })
    expect(screen.getAllByText(/^1 km = /)).toHaveLength(1)
    expect(screen.getByText('1 km = 2,75 pc')).toBeInTheDocument()
    expect(screen.queryByText(/2\.75/)).toBeNull()
  })

  it('formats the preview with a dot for a dot-decimal locale', () => {
    mockLocale = 'en-US'
    const input = renderSection()
    fireEvent.change(input, { target: { value: '2.75' } })
    expect(screen.getAllByText(/^1 km = /)).toHaveLength(1)
    expect(screen.getByText('1 km = 2.75 pc')).toBeInTheDocument()
  })
})
