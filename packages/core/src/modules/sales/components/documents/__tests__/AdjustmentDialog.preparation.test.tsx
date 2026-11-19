/** @jest-environment jsdom */
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AdjustmentDialog } from '../AdjustmentDialog'

const mockApiCall = jest.fn()
let mockLocale = 'en'
let mockFormSubmit: ((values: Record<string, unknown>) => Promise<void>) | null = null
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: (...args: unknown[]) => mockApiCall(...args) }))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => (key: string, fallback?: string) => fallback ?? key, useLocale: () => mockLocale }))
jest.mock('@open-mercato/ui/backend/detail', () => ({ LoadingMessage: ({ label }: { label: string }) => <div role="status">{label}</div> }))
jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: ({ initialValues, onSubmit }: { initialValues: Record<string, unknown>; onSubmit: (values: Record<string, unknown>) => Promise<void> }) => {
    mockFormSubmit = onSubmit
    const [label, setLabel] = React.useState(String(initialValues.label ?? ''))
    React.useEffect(() => setLabel(String(initialValues.label ?? '')), [initialValues])
    return <input aria-label="Adjustment label" value={label} onChange={(event) => setLabel(event.target.value)} />
  },
}))

const options = [{ value: 'custom', label: 'Custom', color: null, icon: null }]
const labels = { addTitle: 'Add adjustment', editTitle: 'Edit adjustment', submitCreate: 'Add adjustment', submitUpdate: 'Save changes' }
const props = { open: true, onOpenChange: jest.fn(), kind: 'quote' as const, currencyCode: 'USD', kindOptions: options, loadKindOptions: jest.fn(async () => options), labels, onSubmit: jest.fn() }

beforeEach(() => { mockApiCall.mockReset(); mockLocale = 'en'; mockFormSubmit = null; props.onSubmit.mockClear() })

describe('AdjustmentDialog preparation and draft lifetime', () => {
  it.each([
    { locale: 'pl', net: '1,23', gross: '1,51' },
    { locale: 'en', net: '1.23', gross: '1.51' },
  ])('uses the shared locale input grammar under $locale', async ({ locale, net, gross }) => {
    mockLocale = locale
    mockApiCall.mockResolvedValue({ ok: true, result: { items: [] } })
    render(<AdjustmentDialog {...props} />)
    await screen.findByRole('textbox', { name: 'Adjustment label' })
    if (!mockFormSubmit) throw new Error('[internal] adjustment form missing')
    await act(async () => mockFormSubmit?.({ label: 'QA amount', kind: 'surcharge', mode: 'amount', amountNet: net, amountGross: gross }))
    expect(props.onSubmit).toHaveBeenCalledWith(expect.objectContaining({ amountNet: 1.23, amountGross: 1.51 }))
  })

  it('refuses malformed numeric text rather than silently absorbing it', async () => {
    mockLocale = 'pl'
    mockApiCall.mockResolvedValue({ ok: true, result: { items: [] } })
    render(<AdjustmentDialog {...props} />)
    await screen.findByRole('textbox', { name: 'Adjustment label' })
    if (!mockFormSubmit) throw new Error('[internal] adjustment form missing')
    await expect(mockFormSubmit({ label: 'QA invalid', kind: 'surcharge', mode: 'amount', amountNet: '1 2', amountGross: '' })).rejects.toThrow()
    expect(props.onSubmit).not.toHaveBeenCalled()
  })

  it('keeps fields unavailable until asynchronous metadata preparation completes', async () => {
    let resolveMetadata: (value: unknown) => void = () => undefined
    mockApiCall.mockImplementation(() => new Promise((resolve) => { resolveMetadata = resolve }))
    render(<AdjustmentDialog {...props} />)
    expect(screen.queryByRole('textbox', { name: 'Adjustment label' })).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('Loading adjustments')
    await act(async () => resolveMetadata({ ok: true, result: { items: [] } }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Adjustment label' })).toBeVisible())
  })

  it('preserves an open draft when kind options and loader identities refresh', async () => {
    mockApiCall.mockResolvedValue({ ok: true, result: { items: [] } })
    const { rerender } = render(<AdjustmentDialog {...props} />)
    const input = await screen.findByRole('textbox', { name: 'Adjustment label' })
    fireEvent.change(input, { target: { value: 'Unsaved shipping label' } })
    rerender(<AdjustmentDialog {...props} kindOptions={[...options]} loadKindOptions={async () => [...options]} />)
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('textbox', { name: 'Adjustment label' })).toHaveValue('Unsaved shipping label')
    rerender(<AdjustmentDialog {...props} open={false} />)
    rerender(<AdjustmentDialog {...props} />)
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Adjustment label' })).toHaveValue(''))
  })
})
