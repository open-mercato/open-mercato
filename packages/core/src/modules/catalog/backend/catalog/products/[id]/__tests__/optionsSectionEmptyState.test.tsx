/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import EditCatalogProductPage from '../page'

type CrudFormGroup = {
  id: string
  component: (props: {
    values: Record<string, unknown>
    setValue: (key: string, value: unknown) => void
    errors: Record<string, unknown>
  }) => React.ReactNode
}

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

// The page reads `useLocale` as well as `useT`; this mock replaces the whole
// module, so omitting either one renders the page as `undefined is not a
// function` rather than exercising it.
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
  useLocale: () => 'en-US',
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

const apiCallMock = apiCall as jest.Mock
const readApiResultOrThrowMock = readApiResultOrThrow as jest.Mock

function findOptionsGroup(): CrudFormGroup {
  const groups = (latestCrudFormProps?.groups ?? []) as CrudFormGroup[]
  const group = groups.find((g) => g.id === 'options')
  if (!group) throw new Error('options group not found')
  return group
}

describe('ProductOptionsSection empty state (#6175)', () => {
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
      if (url.includes('/api/catalog/variants')) {
        return Promise.resolve({
          ok: true,
          result: { items: [{ id: 'var-1', name: 'Default', sku: 'SKU-1' }] },
        })
      }
      return Promise.resolve({ ok: true, result: { items: [] } })
    })
    readApiResultOrThrowMock.mockResolvedValue({ items: [] })
  })

  it('shows the neutral "options are optional" hint when the product has variants but no option schema', async () => {
    render(<EditCatalogProductPage params={{ id: 'prod-1' }} />)
    await waitFor(() =>
      expect(
        apiCallMock.mock.calls.some(
          (call) => typeof call[0] === 'string' && call[0].includes('/api/catalog/variants'),
        ),
      ).toBe(true),
    )
    let lastUnmount: (() => void) | null = null
    await waitFor(() => {
      lastUnmount?.()
      const group = findOptionsGroup()
      const rendered = render(<>{group.component({ values: { options: [] }, setValue: jest.fn(), errors: {} })}</>)
      lastUnmount = rendered.unmount
      expect(
        screen.getByText('This product has variants without an option schema. Options are optional.'),
      ).toBeInTheDocument()
    })
    expect(screen.queryByText('No options yet. Add your first option to generate variants.')).not.toBeInTheDocument()
  })
})
