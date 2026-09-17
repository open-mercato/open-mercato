/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, render, waitFor } from '@testing-library/react'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import EditCatalogProductPage from '../page'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import type { ProductFormValues } from '@open-mercato/core/modules/catalog/components/products/productForm'

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void }
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

let latestCrudFormProps: Record<string, unknown> | null = null

// Stable translate reference so the page's effects (which depend on `t`) run once.
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

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  readApiResultOrThrow: jest.fn(),
  withScopedApiRequestHeaders: jest.fn(
    (_headers: Record<string, string>, run: () => Promise<unknown>) => run(),
  ),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: jest.fn(),
  updateCrud: jest.fn(),
  deleteCrud: jest.fn(),
}))

const updateCrudMock = updateCrud as jest.Mock
const apiCallMock = apiCall as jest.Mock
const readApiResultOrThrowMock = readApiResultOrThrow as jest.Mock

function callsTo(fragment: string): number {
  return apiCallMock.mock.calls.filter(
    (call) => typeof call[0] === 'string' && call[0].includes(fragment),
  ).length
}

function productAttachmentCalls(): number {
  return apiCallMock.mock.calls.filter(
    (call) =>
      typeof call[0] === 'string' &&
      call[0].includes('/api/attachments') &&
      call[0].includes('recordId=prod-1'),
  ).length
}

function variantMediaCalls(): number {
  return apiCallMock.mock.calls.filter(
    (call) =>
      typeof call[0] === 'string' &&
      call[0].includes('/api/attachments') &&
      call[0].includes('recordId=var-1'),
  ).length
}

describe('EditCatalogProductPage — parallel form loaders (#3180)', () => {
  let optionSchema: Deferred<unknown>
  let attachments: Deferred<unknown>
  let conversions: Deferred<unknown>
  let variants: Deferred<unknown>
  let prices: Deferred<unknown>
  let variantMedia: Deferred<unknown>

  beforeEach(() => {
    jest.clearAllMocks()
    latestCrudFormProps = null
    optionSchema = createDeferred()
    attachments = createDeferred()
    conversions = createDeferred()
    variants = createDeferred()
    prices = createDeferred()
    variantMedia = createDeferred()

    apiCallMock.mockImplementation((url: string) => {
      if (url.includes('/api/catalog/products?id=')) {
        return Promise.resolve({
          ok: true,
          result: {
            items: [
              {
                id: 'prod-1',
                title: 'Mock product',
                option_schema_id: 'os-1',
                updated_at: '2026-01-01T00:00:00.000Z',
              },
            ],
          },
        })
      }
      if (url.includes('/api/catalog/option-schemas')) return optionSchema.promise
      if (url.includes('/api/catalog/product-unit-conversions')) return conversions.promise
      if (url.includes('/api/attachments') && url.includes('recordId=prod-1')) return attachments.promise
      if (url.includes('/api/attachments') && url.includes('recordId=var-1')) return variantMedia.promise
      if (url.includes('/api/catalog/variants')) return variants.promise
      if (url.includes('/api/catalog/prices')) return prices.promise
      return Promise.resolve({ ok: true, result: { items: [] } })
    })
    readApiResultOrThrowMock.mockResolvedValue({ items: [] })
  })

  it('dispatches option-schema, attachments, and unit-conversions concurrently (not serialized behind the schema fetch)', async () => {
    render(<EditCatalogProductPage params={{ id: 'prod-1' }} />)
    // The product record resolves immediately. The three independent secondary
    // reads must all be in flight before the option-schema template resolves; in
    // the serialized version, attachments/conversions only fire after the schema.
    await waitFor(() => expect(callsTo('/api/catalog/option-schemas')).toBe(1))
    expect(callsTo('/api/catalog/product-unit-conversions')).toBe(1)
    expect(productAttachmentCalls()).toBe(1)
  })

  it('clears the page loading state before per-variant media resolves (media is section-local)', async () => {
    // The variant list + prices resolve, but the per-variant media (batched
    // attachment fetches) stays pending — it must NOT gate the primary form.
    variants.resolve({ ok: true, result: { items: [{ id: 'var-1', name: 'V1', sku: 'V1' }] } })
    prices.resolve({ ok: true, result: { items: [] } })
    render(<EditCatalogProductPage params={{ id: 'prod-1' }} />)
    await waitFor(() => expect(callsTo('/api/catalog/option-schemas')).toBe(1))
    optionSchema.resolve({ ok: true, result: { items: [{ id: 'os-1', schema: { options: [] } }] } })
    attachments.resolve({ ok: true, result: { items: [] } })
    conversions.resolve({ ok: true, result: { items: [] } })
    // variantMedia intentionally left pending
    await waitFor(() => expect(latestCrudFormProps?.isLoading).toBe(false))
    // The per-variant media fetch was dispatched in the background (section-local).
    await waitFor(() => expect(variantMediaCalls()).toBe(1))
  })
})


describe('EditCatalogProductPage — repeated saves (#5985)', () => {
  let currentVersion: string

  function formValues(): ProductFormValues {
    return latestCrudFormProps?.initialValues as ProductFormValues
  }

  async function saveTitle(title: string) {
    const onSubmit = latestCrudFormProps?.onSubmit as (values: ProductFormValues) => Promise<void>
    await act(async () => onSubmit({ ...formValues(), title }))
  }

  beforeEach(() => {
    jest.clearAllMocks()
    latestCrudFormProps = null
    currentVersion = '2026-09-15T10:00:00.000Z'
    apiCallMock.mockImplementation((url: string) => Promise.resolve({
      ok: true,
      result: {
        items: url.includes('/api/catalog/products?id=')
          ? [{ id: 'prod-1', title: 'Saved product', updated_at: currentVersion }]
          : [],
      },
    }))
    readApiResultOrThrowMock.mockResolvedValue({ items: [] })
    updateCrudMock.mockResolvedValue({ ok: true, result: { ok: true } })
  })

  it('refreshes the form version after every successful save and retains saved values', async () => {
    render(<EditCatalogProductPage params={{ id: 'prod-1' }} />)
    await waitFor(() => expect(latestCrudFormProps?.isLoading).toBe(false))
    expect(formValues().updatedAt).toBe(currentVersion)

    const expectedVersions: unknown[] = []
    updateCrudMock.mockImplementation(async (_path: string, payload: Record<string, unknown>) => {
      expectedVersions.push(formValues().updatedAt)
      expect(formValues().updatedAt).toBe(currentVersion)
      currentVersion = new Date(Date.parse(currentVersion) + 1000).toISOString()
      apiCallMock.mockImplementation((url: string) => Promise.resolve({
        ok: true,
        result: {
          items: url.includes('/api/catalog/products?id=')
            ? [{ id: 'prod-1', title: payload.title, updated_at: currentVersion }]
            : [],
        },
      }))
      return { ok: true, result: { ok: true } }
    })

    await saveTitle('First rename')
    expect(formValues().title).toBe('First rename')
    expect(formValues().updatedAt).toBe('2026-09-15T10:00:01.000Z')
    await saveTitle('Second rename')
    expect(formValues().title).toBe('Second rename')
    expect(formValues().updatedAt).toBe('2026-09-15T10:00:02.000Z')
    expect(expectedVersions).toEqual(['2026-09-15T10:00:00.000Z', '2026-09-15T10:00:01.000Z'])
    expect(updateCrudMock).toHaveBeenCalledTimes(2)
    expect(callsTo('/api/catalog/product-unit-conversions')).toBe(3)
  })

  it('preserves the loaded version and propagates a rejected update without refreshing past a conflict', async () => {
    render(<EditCatalogProductPage params={{ id: 'prod-1' }} />)
    await waitFor(() => expect(latestCrudFormProps?.isLoading).toBe(false))
    const loadedVersion = formValues().updatedAt
    currentVersion = '2026-09-15T10:00:01.000Z'
    const conflict = Object.assign(new Error('Record modified'), { status: 409 })
    updateCrudMock.mockRejectedValueOnce(conflict)

    await expect(saveTitle('Stale rename')).rejects.toBe(conflict)
    expect(formValues().updatedAt).toBe(loadedVersion)
    expect(callsTo('/api/catalog/products?id=')).toBe(1)
  })
})
