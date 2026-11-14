/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import CartAdminDetailPage from '../page'

let grantedFeatures: string[] = []

const apiCallMock = jest.fn()

function makeCartDetail(overrides: Record<string, unknown> = {}) {
  return {
    cart: {
      id: 'cart-1',
      updatedAt: '2026-03-01T00:00:00.000Z',
      status: 'active',
      kind: 'basket',
      channel: 'storefront',
      currencyCode: 'USD',
      locale: 'en-US',
      storeId: null,
      customerId: null,
      customerName: null,
      customerUserId: null,
      email: null,
      note: null,
      requiresApproval: false,
      lines: [],
      totals: {},
      expiresAt: '2099-01-01T00:00:00.000Z',
      ...overrides,
    },
    approval: null,
    mergeLogEntries: [],
    warnings: [],
  }
}

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  apiCallOrThrow: jest.fn(),
  withScopedApiRequestHeaders: (_headers: unknown, fn: () => unknown) => fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: () => ({}),
}))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: () => false,
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: jest.fn(), retryLastMutation: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({ payload: { grantedFeatures }, isReady: true }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}))

// N5 fix (inherited review finding): the Re-price button must only be enabled for a
// principal holding `cart.carts.manage` (the endpoint's own requirement,
// `api/carts/[id]/reprice/route.ts`) — a view-only `cart.carts.view` holder previously saw
// an enabled button that always 403s. Wildcard grants (`cart.*`) must also enable it, since
// `grantedFeatures` is server-expanded by `rbacService.getEffectiveFeatures` but a role can
// still be seeded with a broader wildcard that resolves through `hasFeature`'s own matching.
describe('CartAdminDetailPage — Re-price button RBAC gating (review finding N5)', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
    grantedFeatures = []
  })

  async function renderWithGrants(features: string[], cartOverrides: Record<string, unknown> = {}) {
    grantedFeatures = features
    apiCallMock.mockResolvedValue({ ok: true, result: makeCartDetail(cartOverrides) })
    render(<CartAdminDetailPage params={{ id: 'cart-1' }} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Re-price' })).toBeInTheDocument())
    return screen.getByRole('button', { name: 'Re-price' })
  }

  it('disables Re-price for a viewer holding only cart.carts.view on an active cart', async () => {
    const button = await renderWithGrants(['cart.carts.view'])
    expect(button).toBeDisabled()
  })

  it('enables Re-price for cart.carts.manage on an active cart', async () => {
    const button = await renderWithGrants(['cart.carts.manage'])
    expect(button).toBeEnabled()
  })

  it('enables Re-price for a wildcard grant (cart.*) on an active cart', async () => {
    const button = await renderWithGrants(['cart.*'])
    expect(button).toBeEnabled()
  })

  it('keeps Re-price disabled for cart.carts.manage when the cart status does not allow repricing', async () => {
    const button = await renderWithGrants(['cart.carts.manage'], { status: 'converted' })
    expect(button).toBeDisabled()
  })

  it('stays disabled for a viewer even when the cart status allows repricing (abandoned)', async () => {
    const button = await renderWithGrants(['cart.carts.view'], { status: 'abandoned' })
    expect(button).toBeDisabled()
  })
})
