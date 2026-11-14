/** @jest-environment jsdom */
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AdjustmentDialog } from '../AdjustmentDialog'

const mockApiCall = jest.fn()
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: (...args: unknown[]) => mockApiCall(...args) }))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => (key: string, fallback?: string) => fallback ?? key }))
jest.mock('@open-mercato/ui/backend/detail', () => ({ LoadingMessage: ({ label }: { label: string }) => <div role="status">{label}</div> }))
jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: ({ initialValues }: { initialValues: Record<string, unknown> }) => {
    const [label, setLabel] = React.useState(String(initialValues.label ?? ''))
    React.useEffect(() => setLabel(String(initialValues.label ?? '')), [initialValues])
    return <input aria-label="Adjustment label" value={label} onChange={(event) => setLabel(event.target.value)} />
  },
}))

const options = [{ value: 'custom', label: 'Custom', color: null, icon: null }]
const labels = { addTitle: 'Add adjustment', editTitle: 'Edit adjustment', submitCreate: 'Add adjustment', submitUpdate: 'Save changes' }
const props = { open: true, onOpenChange: jest.fn(), kind: 'quote' as const, currencyCode: 'USD', kindOptions: options, loadKindOptions: jest.fn(async () => options), labels, onSubmit: jest.fn() }

beforeEach(() => mockApiCall.mockReset())

describe('AdjustmentDialog preparation and draft lifetime', () => {
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
