/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, render, waitFor } from '@testing-library/react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { BASE_INITIAL_VALUES } from '@open-mercato/core/modules/catalog/components/products/productForm'
import EditCatalogProductPage from '../page'

let latestCrudFormProps: Record<string, unknown> | null = null

const mockTranslate = (_key: string, fallback?: string) => fallback ?? _key

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

jest.mock('@open-mercato/ui/backend/messages/SendObjectMessageDialog.tsx', () => ({
  SendObjectMessageDialog: () => null,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  readApiResultOrThrow: jest.fn().mockResolvedValue({ items: [] }),
  withScopedApiRequestHeaders: jest.fn(
    (_headers: Record<string, string>, run: () => Promise<unknown>) => run(),
  ),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  updateCrud: jest.fn().mockResolvedValue({ ok: true, result: { ok: true } }),
  createCrud: jest.fn().mockResolvedValue({ ok: true, result: {} }),
  deleteCrud: jest.fn().mockResolvedValue({ ok: true, result: {} }),
}))

const apiCallMock = apiCall as jest.Mock
const updateCrudMock = updateCrud as jest.Mock

describe('EditCatalogProductPage — sequential saves keep the optimistic-lock token fresh (#5985)', () => {
  const productUpdatedAtByCall = ['2026-01-01T00:00:00.000Z', '2026-01-01T00:01:00.000Z', '2026-01-01T00:02:00.000Z']
  let productFetchCount = 0

  beforeEach(() => {
    jest.clearAllMocks()
    latestCrudFormProps = null
    productFetchCount = 0

    apiCallMock.mockImplementation((url: string) => {
      if (url.includes('/api/catalog/products?id=')) {
        const updatedAt = productUpdatedAtByCall[Math.min(productFetchCount, productUpdatedAtByCall.length - 1)]
        productFetchCount += 1
        return Promise.resolve({
          ok: true,
          result: {
            items: [
              {
                id: 'prod-1',
                title: 'Mock product',
                updated_at: updatedAt,
              },
            ],
          },
        })
      }
      return Promise.resolve({ ok: true, result: { items: [] } })
    })
  })

  it('refreshes initialValues.updatedAt after each save so a second consecutive save does not send a stale lock token', async () => {
    render(<EditCatalogProductPage params={{ id: 'prod-1' }} />)

    await waitFor(() => expect(latestCrudFormProps?.isLoading).toBe(false))
    expect((latestCrudFormProps?.initialValues as { updatedAt?: string })?.updatedAt).toBe(
      productUpdatedAtByCall[0],
    )

    const onSubmit = latestCrudFormProps?.onSubmit as (values: unknown) => Promise<void>

    await act(async () => {
      await onSubmit({ ...BASE_INITIAL_VALUES, title: 'First edit' })
    })
    expect(updateCrudMock).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect((latestCrudFormProps?.initialValues as { updatedAt?: string })?.updatedAt).toBe(
        productUpdatedAtByCall[1],
      ),
    )

    await act(async () => {
      await onSubmit({ ...BASE_INITIAL_VALUES, title: 'Second edit' })
    })
    expect(updateCrudMock).toHaveBeenCalledTimes(2)
    await waitFor(() =>
      expect((latestCrudFormProps?.initialValues as { updatedAt?: string })?.updatedAt).toBe(
        productUpdatedAtByCall[2],
      ),
    )
  })
})

describe('EditCatalogProductPage — a successful save keeps the just-edited field visible (#6170)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    latestCrudFormProps = null

    apiCallMock.mockImplementation((url: string) => {
      if (url.includes('/api/catalog/products?id=')) {
        return Promise.resolve({
          ok: true,
          result: {
            items: [
              {
                id: 'prod-1',
                title: 'Mock product',
                updated_at: '2026-01-01T00:00:00.000Z',
              },
            ],
          },
        })
      }
      return Promise.resolve({ ok: true, result: { items: [] } })
    })
  })

  it('does not revert the submitted field back to its stale pre-edit value after save', async () => {
    render(<EditCatalogProductPage params={{ id: 'prod-1' }} />)

    await waitFor(() => expect(latestCrudFormProps?.isLoading).toBe(false))
    expect((latestCrudFormProps?.initialValues as { title?: string })?.title).toBe('Mock product')

    const onSubmit = latestCrudFormProps?.onSubmit as (values: unknown) => Promise<void>

    await act(async () => {
      await onSubmit({ ...BASE_INITIAL_VALUES, title: 'Renamed product' })
    })

    // Before the fix, initialValues only had `updatedAt` refreshed — title stayed
    // at the stale pre-edit snapshot ('Mock product'), which made CrudForm's
    // initialValues-resync effect revert the visibly-saved title back to it.
    await waitFor(() =>
      expect((latestCrudFormProps?.initialValues as { title?: string })?.title).toBe(
        'Renamed product',
      ),
    )
  })
})
