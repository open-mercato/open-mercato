/** @jest-environment jsdom */

import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

const apiCallMock = jest.fn()

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const translate = (key: string) => key
  return { useT: () => translate }
})

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('@open-mercato/ui/backend/inputs', () => ({
  LookupSelect: ({ onChange }: { onChange: (value: string | null) => void }) => (
    <div>
      <button type="button" onClick={() => onChange('product-a')}>Product A</button>
      <button type="button" onClick={() => onChange('product-b')}>Product B</button>
    </div>
  ),
}))

import { ClaimLineProductPicker } from '../backend/components/productLookup'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill
  })
  return { promise, resolve }
}

function productResponse(id: string, title: string) {
  return {
    result: {
      items: [{ id, title, sku: `${id}-sku`, isConfigurable: false }],
    },
  }
}

describe('ClaimLineProductPicker', () => {
  it('ignores a stale product response after a newer selection', async () => {
    const first = deferred<ReturnType<typeof productResponse>>()
    const second = deferred<ReturnType<typeof productResponse>>()
    const onPick = jest.fn()
    apiCallMock.mockImplementation((url: string) => {
      if (url.includes('/api/catalog/variants')) return Promise.resolve({ result: { items: [] } })
      if (url.includes('product-a')) return first.promise
      if (url.includes('product-b')) return second.promise
      return Promise.resolve({ result: { items: [] } })
    })

    render(
      <ClaimLineProductPicker
        value={{}}
        onPick={onPick}
        onClear={() => undefined}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Product A' }))
    fireEvent.click(screen.getByRole('button', { name: 'Product B' }))

    await act(async () => {
      second.resolve(productResponse('product-b', 'Product B'))
      await second.promise
    })
    await waitFor(() => expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ productId: 'product-b' })))

    await act(async () => {
      first.resolve(productResponse('product-a', 'Product A'))
      await first.promise
    })

    expect(onPick).toHaveBeenCalledTimes(1)
  })
})
