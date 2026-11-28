import * as React from 'react'
import { renderToString } from 'react-dom/server'
import pl from '../../../../i18n/pl.json'

type RowAction = { id: string; onSelect?: () => Promise<void> }
const mockActions: RowAction[] = []
const mockFlash = jest.fn()
const mockApiCall = jest.fn()
const mockReadApiResult = jest.fn()
const mockRunMutation = jest.fn(({ operation }: { operation: () => Promise<void> }) => operation())

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => (pl as Record<string, string>)[key] ?? fallback ?? key,
}))
jest.mock('next/link', () => ({ __esModule: true, default: () => null }))
jest.mock('lucide-react', () => ({ Plus: () => null }))
jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: React.PropsWithChildren) => children,
  PageBody: ({ children }: React.PropsWithChildren) => children,
}))
jest.mock('@open-mercato/ui/primitives/button', () => ({ Button: () => null }))
jest.mock('@open-mercato/ui/primitives/badge', () => ({ Badge: () => null }))
jest.mock('@open-mercato/ui/backend/filters/ListEmptyState', () => ({ ListEmptyState: () => null }))
jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: ({ rowActions }: { rowActions: (row: Record<string, unknown>) => React.ReactNode }) => rowActions({
    id: 'test-link', slug: 'test-link', status: 'draft',
  }),
}))
jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: ({ items }: { items: RowAction[] }) => {
    mockActions.splice(0, mockActions.length, ...items)
    return null
  },
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => mockFlash(...args),
}))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: mockRunMutation }),
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: (...args: unknown[]) => mockApiCall(...args),
  readApiResultOrThrow: (...args: unknown[]) => mockReadApiResult(...args),
}))

import CheckoutPayLinksPage from '../page'

async function publish() {
  renderToString(<CheckoutPayLinksPage />)
  const action = mockActions.find((item) => item.id === 'publish')
  expect(action?.onSelect).toBeDefined()
  await action?.onSelect?.()
}

describe('pay-link list mutation errors', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockReadApiResult.mockResolvedValue({ items: [], total: 0, totalPages: 1 })
  })

  it('shows the translated payer-field explanation instead of the generic server validation message', async () => {
    mockApiCall.mockRejectedValue({
      error: 'Validation failed',
      fieldErrors: { gatewayProviderKey: 'checkout.validation.gatewayProviderKey.payerFieldsNotCollected' },
    })

    await publish()

    expect(mockFlash).toHaveBeenCalledTimes(1)
    expect(mockFlash).toHaveBeenCalledWith(pl['checkout.validation.gatewayProviderKey.payerFieldsNotCollected'], 'error')
    expect(mockReadApiResult).not.toHaveBeenCalled()
    expect(mockApiCall).toHaveBeenCalledWith('/api/checkout/links/test-link', expect.objectContaining({
      method: 'PUT', body: JSON.stringify({ status: 'active' }),
    }))
  })

  it('preserves a server refusal without field errors', async () => {
    mockApiCall.mockRejectedValue(new Error('Forbidden'))
    await publish()
    expect(mockFlash).toHaveBeenCalledWith('Forbidden', 'error')
    expect(mockReadApiResult).not.toHaveBeenCalled()
  })

  it('uses the translated action fallback for an unknown field message', async () => {
    mockApiCall.mockRejectedValue({ error: 'Validation failed', fieldErrors: { status: 'unknown.validation.key' } })
    await publish()
    expect(mockFlash).toHaveBeenCalledWith(pl['checkout.admin.payLinks.flash.publishError'], 'error')
  })

  it('reloads and shows success only when publishing succeeds', async () => {
    mockApiCall.mockResolvedValue({ ok: true })
    await publish()
    expect(mockFlash).toHaveBeenCalledWith(pl['checkout.admin.payLinks.flash.published'], 'success')
    expect(mockReadApiResult).toHaveBeenCalledTimes(1)
  })
})
