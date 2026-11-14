/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import { useQuoteSendDefaults } from '../useQuoteSendDefaults'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

let mockScopeVersion = 0
const mockTranslate = (key: string) => key
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => mockTranslate }))
jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({ useOrganizationScopeVersion: () => mockScopeVersion }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ readApiResultOrThrow: jest.fn() }))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

beforeEach(() => { jest.clearAllMocks(); mockScopeVersion = 0 })
it('loads the current fallback each time the dialog opens and preserves manual edits', async () => {
  jest.mocked(readApiResultOrThrow).mockResolvedValue({ defaultQuoteValidityDays: 30 })
  const { result } = renderHook(() => useQuoteSendDefaults('quote', null))
  await act(async () => result.current.openSendDialog())
  expect(result.current.sendOpen).toBe(true)
  expect(result.current.validForDays).toBe(30)
  act(() => result.current.setValidForDays(45))
  expect(result.current.validForDays).toBe(45)
  act(() => result.current.setSendOpen(false))
  jest.mocked(readApiResultOrThrow).mockResolvedValue({ defaultQuoteValidityDays: 60 })
  await act(async () => result.current.openSendDialog())
  expect(result.current.validForDays).toBe(60)
})
it('keeps a usable quote date ahead of the configured default', async () => {
  jest.mocked(readApiResultOrThrow).mockResolvedValue({ defaultQuoteValidityDays: 30 })
  const validUntil = new Date(Date.now() + 5 * 86400000).toISOString()
  const { result } = renderHook(() => useQuoteSendDefaults('quote', validUntil))
  await act(async () => result.current.openSendDialog())
  expect(result.current.validForDays).toBe(5)
})
it('leaves the dialog closed and surfaces a failed settings read', async () => {
  jest.mocked(readApiResultOrThrow).mockRejectedValue(new Error('[internal] offline'))
  const { result } = renderHook(() => useQuoteSendDefaults('quote', null))
  await act(async () => result.current.openSendDialog())
  expect(result.current.sendOpen).toBe(false)
  expect(result.current.loading).toBe(false)
  expect(flash).toHaveBeenCalledWith('sales.settings.errors.load_failed', 'error')
})
it.each(['organization', 'document'])('ignores an obsolete response after changing %s', async (change) => {
  let resolveRead: (value: { defaultQuoteValidityDays: number }) => void = () => {}
  jest.mocked(readApiResultOrThrow).mockReturnValue(new Promise((resolve) => { resolveRead = resolve }))
  const { result, rerender } = renderHook(({ documentId }) => useQuoteSendDefaults(documentId, null), { initialProps: { documentId: 'quote-1' } })
  let pending: Promise<void> = Promise.resolve()
  act(() => { pending = result.current.openSendDialog() })
  if (change === 'organization') mockScopeVersion += 1
  rerender({ documentId: change === 'document' ? 'quote-2' : 'quote-1' })
  await act(async () => { resolveRead({ defaultQuoteValidityDays: 30 }); await pending })
  expect(result.current.sendOpen).toBe(false)
  expect(result.current.loading).toBe(false)
  expect(flash).not.toHaveBeenCalled()
})
