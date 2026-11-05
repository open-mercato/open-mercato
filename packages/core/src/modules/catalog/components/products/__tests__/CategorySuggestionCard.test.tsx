/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CategorySuggestionCard } from '../CategorySuggestionCard'

if (typeof window !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => undefined
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined
}

type ApiResult = { ok: boolean; status: number; response: { status: number; text: () => Promise<string> }; result: unknown }

const mockApiCall = jest.fn<Promise<ApiResult>, [string, RequestInit?]>()
const mockReadApiResultOrThrow = jest.fn()
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: [string, RequestInit?]) => mockApiCall(...args),
  readApiResultOrThrow: (...args: unknown[]) => mockReadApiResultOrThrow(...args),
  withScopedApiRequestHeaders: (_headers: unknown, run: () => Promise<unknown>) => run(),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: () => ({}),
}))

jest.mock('@open-mercato/ui/backend/utils/serverErrors', () => ({
  raiseCrudError: async (response: { status: number }, fallback: string) => {
    throw new Error(`[internal] ${fallback} (${response.status})`)
  },
}))

const mockRunMutation = jest.fn(async (input: { operation: () => Promise<unknown> }) => input.operation())
const mockRetryLastMutation = jest.fn(async () => true)
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: (input: { operation: () => Promise<unknown> }) => mockRunMutation(input),
    retryLastMutation: mockRetryLastMutation,
  }),
}))

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({
    payload: { grantedFeatures: ['catalog.ai_categorization.use'] },
    isReady: true,
  }),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111'
const SUGGESTION_ID = '22222222-2222-4222-8222-222222222222'

const NO_MATCH_SUGGESTION = {
  id: SUGGESTION_ID,
  productId: PRODUCT_ID,
  outcome: 'no_match' as const,
  categoryId: null,
  categoryPathIds: [],
  confidence: null,
  levels: [],
  status: 'pending',
  updatedAt: new Date().toISOString(),
}

function mockLoads() {
  mockReadApiResultOrThrow.mockImplementation(async (url: string) => {
    if (url.includes('/settings')) return { effective: true }
    if (url.includes('/category-suggestions')) return { items: [NO_MATCH_SUGGESTION] }
    return {}
  })
}

describe('CategorySuggestionCard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockLoads()
  })

  // R8: a no_match outcome must not be a dead end — the operator needs a way
  // to retry or dismiss it so the card does not get stuck forever.
  it('offers Suggest again and Reject when the outcome is no_match', async () => {
    render(
      <CategorySuggestionCard
        productId={PRODUCT_ID}
        categoryIds={[]}
        initialCategoryIds={[]}
        setValue={jest.fn()}
        registerCategoryOptions={jest.fn()}
      />,
    )

    await screen.findByText('No matching category was found.')
    expect(screen.getByRole('button', { name: /suggest again/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /^reject$/i })).toBeEnabled()
  })

  it('rejecting a no_match suggestion clears it through the guarded mutation flow', async () => {
    mockApiCall.mockResolvedValue({
      ok: true,
      status: 200,
      response: { status: 200, text: async () => '' },
      result: { id: SUGGESTION_ID },
    })

    render(
      <CategorySuggestionCard
        productId={PRODUCT_ID}
        categoryIds={[]}
        initialCategoryIds={[]}
        setValue={jest.fn()}
        registerCategoryOptions={jest.fn()}
      />,
    )

    const rejectButton = await screen.findByRole('button', { name: /^reject$/i })
    fireEvent.click(rejectButton)

    await waitFor(() => expect(mockRunMutation).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByText('No matching category was found.')).not.toBeInTheDocument())
    expect(mockRunMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ resourceKind: 'catalog.category_suggestion', retryLastMutation: mockRetryLastMutation }),
      }),
    )
  })
})
