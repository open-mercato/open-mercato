/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AiCategorizationSettings } from '../AiCategorizationSettings'

if (typeof window !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => undefined
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined
}

type ApiResult = { ok: boolean; response: { status: number }; result: unknown }

const mockApiCall = jest.fn<Promise<ApiResult>, [string, RequestInit?]>()
const mockReadApiResultOrThrow = jest.fn()
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: [string, RequestInit?]) => mockApiCall(...args),
  readApiResultOrThrow: (...args: unknown[]) => mockReadApiResultOrThrow(...args),
}))

const mockRunMutation = jest.fn(async (input: { operation: () => Promise<unknown> }) => input.operation())
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: (input: { operation: () => Promise<unknown> }) => mockRunMutation(input),
    retryLastMutation: jest.fn(async () => true),
  }),
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 1,
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

const SETTINGS = {
  enabled: true,
  applyMode: 'suggest' as const,
  autoApplyThreshold: 0.85,
  autoSuggestOnCreate: false,
}

function mockLoad(overrides: { available?: boolean; settings?: typeof SETTINGS } = {}) {
  mockReadApiResultOrThrow.mockResolvedValue({
    settings: overrides.settings ?? SETTINGS,
    available: overrides.available ?? false,
    effective: (overrides.available ?? false) && (overrides.settings ?? SETTINGS).enabled,
  })
}

describe('AiCategorizationSettings', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockApiCall.mockResolvedValue({ ok: true, response: { status: 200 }, result: {} })
  })

  // R9: a tenant that already enabled the feature while a decision model was
  // configured must still be able to turn it off after the provider is
  // removed — only re-enabling requires `available`.
  it('keeps the toggle enabled for turning off even when the provider is unavailable', async () => {
    mockLoad({ available: false, settings: { ...SETTINGS, enabled: true } })
    render(<AiCategorizationSettings />)
    const toggle = await screen.findByRole('switch', { name: /enable ai category suggestions/i })
    await waitFor(() => expect(toggle).not.toBeDisabled())
  })

  it('disables the toggle when the feature is off and no provider is configured', async () => {
    mockLoad({ available: false, settings: { ...SETTINGS, enabled: false } })
    render(<AiCategorizationSettings />)
    const toggle = await screen.findByRole('switch', { name: /enable ai category suggestions/i })
    await waitFor(() => expect(toggle).toBeDisabled())
  })

  // R6: the settings PUT must run through the shared guarded-mutation flow,
  // not a bare apiCall, so an installed client guard can veto it.
  it('saves through the guarded mutation flow', async () => {
    mockLoad({ available: true, settings: { ...SETTINGS, enabled: true } })
    render(<AiCategorizationSettings />)
    const toggle = await screen.findByRole('switch', { name: /enable ai category suggestions/i })
    fireEvent.click(toggle)
    await waitFor(() => expect(mockRunMutation).toHaveBeenCalled())
    const call = mockRunMutation.mock.calls[0]?.[0] as { context?: { resourceKind?: string } }
    expect(call.context?.resourceKind).toBe('catalog.settings')
  })
})
