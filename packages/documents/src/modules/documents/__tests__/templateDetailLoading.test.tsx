/** @jest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react'

const apiCallMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

import { useTemplateDetail } from '../backend/documents/components/useTemplateDetail'

const FIRST_TEMPLATE_ID = '11111111-1111-4111-8111-111111111111'
const SECOND_TEMPLATE_ID = '22222222-2222-4222-8222-222222222222'
const UPDATED_AT = '2026-07-11T08:00:00.000Z'

function templateDetail(id: string, bodyHtml: string) {
  return {
    id,
    name: `Template ${id.slice(0, 1)}`,
    description: null,
    bodyHtml,
    contextSlots: [],
    isActive: true,
    updatedAt: UPDATED_AT,
    createdAt: UPDATED_AT,
  }
}

describe('useTemplateDetail', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('loads the large body only from the selected template detail endpoint', async () => {
    apiCallMock.mockResolvedValue({
      ok: true,
      result: templateDetail(FIRST_TEMPLATE_ID, '<p>Selected body</p>'),
    })

    const { result } = renderHook(() => useTemplateDetail(true, FIRST_TEMPLATE_ID))

    await waitFor(() => expect(result.current.template?.bodyHtml).toBe('<p>Selected body</p>'))
    expect(apiCallMock).toHaveBeenCalledTimes(1)
    expect(apiCallMock).toHaveBeenCalledWith(
      `/api/documents/templates/${FIRST_TEMPLATE_ID}`,
      { signal: expect.any(AbortSignal) },
      { fallback: null },
    )
  })

  it('aborts a stale detail request and never exposes it after selection changes', async () => {
    let staleSignal: AbortSignal | undefined
    apiCallMock.mockImplementation((url: string, options?: RequestInit) => {
      if (url === `/api/documents/templates/${FIRST_TEMPLATE_ID}`) {
        staleSignal = options?.signal ?? undefined
        return new Promise((_resolve, reject) => {
          staleSignal?.addEventListener('abort', () => reject(staleSignal?.reason), { once: true })
        })
      }
      if (url === `/api/documents/templates/${SECOND_TEMPLATE_ID}`) {
        return Promise.resolve({
          ok: true,
          result: templateDetail(SECOND_TEMPLATE_ID, '<p>Fresh body</p>'),
        })
      }
      throw new Error(`Unexpected API call: ${url}`)
    })

    const { result, rerender } = renderHook(
      ({ templateId }: { templateId: string }) => useTemplateDetail(true, templateId),
      { initialProps: { templateId: FIRST_TEMPLATE_ID } },
    )
    await waitFor(() => expect(staleSignal).toBeDefined())

    act(() => rerender({ templateId: SECOND_TEMPLATE_ID }))

    expect(staleSignal?.aborted).toBe(true)
    expect(result.current.template).toBeNull()
    await waitFor(() => expect(result.current.template).toMatchObject({
      id: SECOND_TEMPLATE_ID,
      bodyHtml: '<p>Fresh body</p>',
    }))
    expect(result.current.error).toBe(false)
  })

  it('retries a failed detail request and exposes the recovered template', async () => {
    apiCallMock
      .mockResolvedValueOnce({ ok: false, status: 503, result: null })
      .mockResolvedValueOnce({
        ok: true,
        result: templateDetail(FIRST_TEMPLATE_ID, '<p>Recovered body</p>'),
      })

    const { result } = renderHook(() => useTemplateDetail(true, FIRST_TEMPLATE_ID))
    await waitFor(() => expect(result.current.error).toBe(true))

    act(() => result.current.retry())

    await waitFor(() => expect(result.current.template?.bodyHtml).toBe('<p>Recovered body</p>'))
    expect(apiCallMock).toHaveBeenCalledTimes(2)
  })
})
