/** @jest-environment jsdom */
import * as React from 'react'
import { act, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import enDict from '../../../../i18n/en.json'
import plDict from '../../../../i18n/pl.json'
import { ResolutionPreviewPanel } from '../ResolutionPreviewPanel'

const apiCallMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

function renderPanel(productId = 'product-one', dict = enDict, onTraceChange = jest.fn()) {
  return renderWithProviders(
    <ResolutionPreviewPanel productId={productId} variantId={null} storeId={null} onTraceChange={onTraceChange} />,
    { dict },
  )
}

async function finishDebounce() {
  await act(async () => { jest.advanceTimersByTime(300) })
}

describe('ResolutionPreviewPanel', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    apiCallMock.mockReset()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('shows loading through debounce and pending requests without inventing defaults', async () => {
    apiCallMock.mockReturnValue(new Promise(() => {}))
    renderPanel()
    expect(screen.getByText(enDict['availability.common.loading'])).toBeInTheDocument()
    expect(screen.queryByText(enDict['availability.policies.form.preview.moduleDefault'], { exact: false })).not.toBeInTheDocument()
    await finishDebounce()
    expect(screen.getByText(enDict['availability.common.loading'])).toBeInTheDocument()
  })

  it.each([enDict, plDict])('announces translated organization rejection without default values', async (dict) => {
    apiCallMock.mockResolvedValue({ ok: false, status: 422, result: {
      error: dict['availability.errors.organizationSelectionInvalid'], code: 'organization_selection_invalid',
    } })
    renderPanel('product-one', dict)
    await finishDebounce()
    expect(screen.getByRole('alert')).toHaveTextContent(dict['availability.errors.organizationSelectionInvalid'])
    expect(screen.queryByText(dict['availability.policies.form.preview.moduleDefault'], { exact: false })).not.toBeInTheDocument()
  })

  it.each(['network', 'missing-error'])('shows a translated fallback for %s failure', async (failure) => {
    if (failure === 'network') apiCallMock.mockRejectedValue(new Error('transport unavailable'))
    else apiCallMock.mockResolvedValue({ ok: false, status: 500, result: {} })
    renderPanel()
    await finishDebounce()
    expect(screen.getByRole('alert')).toHaveTextContent(enDict['availability.policies.form.preview.failed'])
    expect(screen.queryByText(enDict['availability.policies.form.preview.moduleDefault'], { exact: false })).not.toBeInTheDocument()
  })

  it('clears rejected state when the target changes and publishes the recovered trace', async () => {
    const onTraceChange = jest.fn()
    apiCallMock.mockResolvedValueOnce({ ok: false, status: 422, result: { error: 'Organization rejected' } })
    const { rerender } = renderPanel('product-one', enDict, onTraceChange)
    await finishDebounce()
    expect(screen.getByRole('alert')).toHaveTextContent('Organization rejected')
    const trace = { lowStockThreshold: { value: 789, policySourceId: 'policy-two' } }
    apiCallMock.mockResolvedValueOnce({ ok: true, status: 200, result: { policyTrace: trace } })
    rerender(<ResolutionPreviewPanel productId="product-two" variantId={null} storeId={null} onTraceChange={onTraceChange} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText(enDict['availability.common.loading'])).toBeInTheDocument()
    await finishDebounce()
    expect(screen.getByText('789', { exact: false })).toBeInTheDocument()
    expect(onTraceChange).toHaveBeenLastCalledWith(trace)
  })

  it('ignores a superseded response after a new target has rejected', async () => {
    let resolveOldRequest: (value: unknown) => void = () => {}
    apiCallMock.mockReturnValueOnce(new Promise((resolve) => { resolveOldRequest = resolve }))
    const { rerender } = renderPanel()
    await finishDebounce()
    apiCallMock.mockResolvedValueOnce({ ok: false, status: 422, result: { error: 'Current rejection' } })
    rerender(<ResolutionPreviewPanel productId="product-two" variantId={null} storeId={null} />)
    await finishDebounce()
    await act(async () => { resolveOldRequest({ ok: true, result: { policyTrace: { lowStockThreshold: { value: 789, policySourceId: null } } } }) })
    expect(screen.getByRole('alert')).toHaveTextContent('Current rejection')
    expect(screen.queryByText('789', { exact: false })).not.toBeInTheDocument()
  })
})
