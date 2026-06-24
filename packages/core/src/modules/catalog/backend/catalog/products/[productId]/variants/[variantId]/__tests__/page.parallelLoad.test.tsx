/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, waitFor } from '@testing-library/react'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import EditVariantPage from '../page'

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void }
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

// Stable translate reference so the page's effects (which depend on `t`) run once.
const mockTranslate = (_key: string, fallback?: string) => fallback ?? _key

let latestCrudFormProps: Record<string, unknown> | null = null

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: Record<string, unknown>) => {
    latestCrudFormProps = props
    return null
  },
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
}))

jest.mock('next/link', () => ({ children }: { children: React.ReactNode }) => <span>{children}</span>)

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  readApiResultOrThrow: jest.fn(),
  withScopedApiRequestHeaders: jest.fn(
    (_headers: Record<string, string>, run: () => Promise<unknown>) => run(),
  ),
}))

const apiCallMock = apiCall as jest.Mock
const readApiResultOrThrowMock = readApiResultOrThrow as jest.Mock

function callsTo(fragment: string): number {
  return apiCallMock.mock.calls.filter(
    (call) => typeof call[0] === 'string' && call[0].includes(fragment),
  ).length
}

describe('EditVariantPage — parallel form loaders (#3180)', () => {
  let attachments: Deferred<unknown>
  let prices: Deferred<unknown>
  let product: Deferred<unknown>

  beforeEach(() => {
    jest.clearAllMocks()
    latestCrudFormProps = null
    attachments = createDeferred()
    prices = createDeferred()
    product = createDeferred()

    apiCallMock.mockImplementation((url: string) => {
      if (url.includes('/api/catalog/variants?id=')) {
        return Promise.resolve({
          ok: true,
          result: {
            items: [
              {
                id: 'v-1',
                product_id: 'prod-1',
                name: 'Variant 1',
                option_values: {},
                updated_at: '2026-01-01T00:00:00.000Z',
              },
            ],
          },
        })
      }
      if (url.includes('/api/attachments')) return attachments.promise
      if (url.includes('/api/catalog/prices?variantId=')) return prices.promise
      if (url.includes('/api/catalog/products?id=')) return product.promise
      return Promise.resolve({ ok: true, result: { items: [] } })
    })
    readApiResultOrThrowMock.mockImplementation((url: string) => {
      if (url.includes('/api/catalog/price-kinds')) {
        return Promise.resolve({
          items: [{ id: 'pk-1', code: 'regular', title: 'Regular', display_mode: 'including-tax' }],
        })
      }
      return Promise.resolve({ items: [] })
    })
  })

  it('dispatches variant attachments, prices, and product-context reads concurrently once the variant record is known', async () => {
    render(<EditVariantPage params={{ productId: 'prod-1', variantId: 'v-1' }} />)
    // The variant record resolves immediately; the three independent secondary
    // reads must all be in flight together. In the serialized version, prices and
    // product-context only fire after attachments resolves.
    await waitFor(() => expect(callsTo('/api/attachments')).toBe(1))
    expect(callsTo('/api/catalog/prices?variantId=')).toBe(1)
    expect(callsTo('/api/catalog/products?id=')).toBe(1)
  })
})
