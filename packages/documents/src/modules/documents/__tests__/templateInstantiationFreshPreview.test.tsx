/** @jest-environment jsdom */

import { act, renderHook } from '@testing-library/react'

const apiCallMock = jest.fn()
const apiCallOrThrowMock = jest.fn()
const runMutationMock = jest.fn()
const routerPushMock = jest.fn()
const retryLastMutationMock = jest.fn(async () => false)
const translateMock = (key: string) => key

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  apiCallOrThrow: (...args: unknown[]) => apiCallOrThrowMock(...args),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: runMutationMock,
    retryLastMutation: retryLastMutationMock,
  }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => translateMock,
  useLocale: () => 'pl',
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPushMock }),
}))

import { useTemplateInstantiation } from '../backend/documents/components/useTemplateInstantiation'

const TEMPLATE_ID = '11111111-1111-4111-8111-111111111111'
const PERSON_ID = '22222222-2222-4222-8222-222222222222'
const TEMPLATE_UPDATED_AT = '2026-07-10T01:00:00.000Z'
const TEMPLATE_LIST_URL = '/api/documents/templates?page=1&pageSize=50&isActive=true&includeBody=false'

function templateRecord(index: number, isActive = true) {
  return {
    id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
    name: `Template ${index}`,
    description: `Description ${index}`,
    contextSlots: [],
    isActive,
    updatedAt: TEMPLATE_UPDATED_AT,
    createdAt: TEMPLATE_UPDATED_AT,
  }
}

async function flushPromises(iterations = 8): Promise<void> {
  for (let index = 0; index < iterations; index += 1) await Promise.resolve()
}

describe('useTemplateInstantiation preview freshness', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-07-10T02:00:00.000Z') })
    apiCallMock.mockReset().mockImplementation((url: string, options?: RequestInit) => {
      if (url === TEMPLATE_LIST_URL) {
        return Promise.resolve({
          ok: true,
          result: {
            items: [{
              id: TEMPLATE_ID,
              name: 'Customer brief',
              description: 'Contextual customer brief',
              contextSlots: [{ slot: 'customer', entityType: 'customer-person', required: true }],
              isActive: true,
              updatedAt: TEMPLATE_UPDATED_AT,
              createdAt: TEMPLATE_UPDATED_AT,
            }],
            total: 1,
            page: 1,
            pageSize: 100,
            totalPages: 1,
          },
        })
      }
      if (url === `/api/documents/templates/${TEMPLATE_ID}/preview`) {
        const input = JSON.parse(String(options?.body)) as { title: string }
        return Promise.resolve({
          ok: true,
          result: {
            contentHtml: `<h1>${input.title}</h1>`,
            unresolvedTokens: [],
            templateUpdatedAt: TEMPLATE_UPDATED_AT,
            previewDigest: `digest:${input.title}`,
          },
        })
      }
      throw new Error(`Unexpected API call: ${url}`)
    })
    apiCallOrThrowMock.mockReset()
    runMutationMock.mockReset()
    routerPushMock.mockReset()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('invalidates a stale digest immediately and blocks submit until the changed title is re-previewed', async () => {
    const presetContext = {
      entityType: 'customer-person' as const,
      entityId: PERSON_ID,
      label: 'Related Person',
      values: { name: 'Related Person' },
    }
    const onOpenChange = jest.fn()
    const { result } = renderHook(() => useTemplateInstantiation({
      open: true,
      onOpenChange,
      presetContext,
    }))

    await act(async () => {
      jest.advanceTimersByTime(0)
      await flushPromises()
    })
    expect(result.current.templates).toHaveLength(1)
    expect(result.current.templates[0]?.bodyHtml).toBe('')
    expect(apiCallMock).not.toHaveBeenCalledWith(
      `/api/documents/templates/${TEMPLATE_ID}/preview`,
      expect.anything(),
    )

    await act(async () => {
      result.current.setSelectedTemplateId(TEMPLATE_ID)
      await Promise.resolve()
    })
    await act(async () => {
      jest.advanceTimersByTime(250)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.preview?.previewDigest).toContain('Customer brief')
    expect(apiCallMock).toHaveBeenCalledWith(
      `/api/documents/templates/${TEMPLATE_ID}/preview`,
      expect.objectContaining({ method: 'POST' }),
    )
    const previewRequest = apiCallMock.mock.calls.find(([url]) => url === `/api/documents/templates/${TEMPLATE_ID}/preview`)
    expect(JSON.parse(String((previewRequest?.[1] as RequestInit | undefined)?.body))).toMatchObject({ locale: 'pl' })

    act(() => result.current.setTitle('Updated customer brief'))

    expect(result.current.preview).toBeNull()
    expect(result.current.isPreviewLoading).toBe(true)
    await act(async () => result.current.submit())
    expect(runMutationMock).not.toHaveBeenCalled()

    await act(async () => {
      jest.advanceTimersByTime(250)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.preview?.previewDigest).toBe('digest:Updated customer brief')
    expect(result.current.isPreviewLoading).toBe(false)
  })

  it('allows only one instantiation when submit is called twice before React commits state', async () => {
    const presetContext = {
      entityType: 'customer-person' as const,
      entityId: PERSON_ID,
      label: 'Related Person',
      values: { name: 'Related Person' },
    }
    let resolveInstantiation: ((value: { id: string }) => void) | undefined
    apiCallOrThrowMock.mockImplementation(() => new Promise<{ id: string }>((resolve) => {
      resolveInstantiation = resolve
    }))
    runMutationMock.mockImplementation(async ({ operation }: { operation: () => Promise<{ id: string }> }) => ({
      result: await operation(),
    }))
    const { result } = renderHook(() => useTemplateInstantiation({
      open: true,
      onOpenChange: jest.fn(),
      presetContext,
    }))
    await act(async () => {
      jest.advanceTimersByTime(0)
      await flushPromises()
      result.current.setSelectedTemplateId(TEMPLATE_ID)
      await Promise.resolve()
    })
    await act(async () => {
      jest.advanceTimersByTime(250)
      await flushPromises()
    })
    expect(result.current.preview?.unresolvedTokens).toEqual([])

    let firstSubmit: Promise<void> | undefined
    let secondSubmit: Promise<void> | undefined
    act(() => {
      firstSubmit = result.current.submit()
      secondSubmit = result.current.submit()
    })

    expect(runMutationMock).toHaveBeenCalledTimes(1)
    expect(apiCallOrThrowMock).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolveInstantiation?.({ id: '33333333-3333-4333-8333-333333333333' })
      await Promise.all([firstSubmit, secondSubmit])
    })
    expect(routerPushMock).toHaveBeenCalledTimes(1)
  })

  it('caps the in-memory summary page and finds template 101 through bounded server search', async () => {
    const oversizedPage = Array.from({ length: 75 }, (_, index) => templateRecord(index + 1))
    const template101 = templateRecord(101)
    apiCallMock.mockImplementation((url: string) => {
      if (url === TEMPLATE_LIST_URL) {
        return Promise.resolve({
          ok: true,
          result: { items: oversizedPage, total: 102, page: 1, pageSize: 50, totalPages: 3 },
        })
      }
      if (url === `${TEMPLATE_LIST_URL}&search=Description+101`) {
        return Promise.resolve({
          ok: true,
          result: { items: [template101], total: 1, page: 1, pageSize: 50, totalPages: 1 },
        })
      }
      throw new Error(`Unexpected API call: ${url}`)
    })

    const { result } = renderHook(() => useTemplateInstantiation({
      open: true,
      onOpenChange: jest.fn(),
    }))
    await act(async () => {
      jest.advanceTimersByTime(0)
      await flushPromises()
    })

    expect(result.current.templates).toHaveLength(50)
    expect(apiCallMock.mock.calls.some(([url]) => String(url).includes('page=2'))).toBe(false)

    act(() => result.current.setTemplateSearch('Description 101'))
    expect(result.current.isLoading).toBe(true)
    expect(result.current.templates).toEqual([])
    await act(async () => {
      jest.advanceTimersByTime(200)
      await flushPromises()
    })
    expect(result.current.templates).toEqual([expect.objectContaining({ id: template101.id, name: 'Template 101' })])
    expect(result.current.isLoading).toBe(false)
    const searchCall = apiCallMock.mock.calls.find(([url]) => url === `${TEMPLATE_LIST_URL}&search=Description+101`)
    expect(searchCall?.[1]?.signal).toBeDefined()
    expect(searchCall?.[1]?.signal.aborted).toBe(false)
  })

  it('aborts and ignores a stale server search before applying the next result', async () => {
    let staleSearchSignal: AbortSignal | undefined
    apiCallMock.mockImplementation((url: string, options?: RequestInit) => {
      if (url === TEMPLATE_LIST_URL) {
        return Promise.resolve({
          ok: true,
          result: { items: [templateRecord(1)], total: 1, page: 1, pageSize: 50, totalPages: 1 },
        })
      }
      if (url === `${TEMPLATE_LIST_URL}&search=stale`) {
        staleSearchSignal = options?.signal ?? undefined
        return new Promise((_resolve, reject) => {
          staleSearchSignal?.addEventListener('abort', () => reject(staleSearchSignal?.reason), { once: true })
        })
      }
      if (url === `${TEMPLATE_LIST_URL}&search=fresh`) {
        return Promise.resolve({
          ok: true,
          result: {
            items: [{ ...templateRecord(2), name: 'Fresh template' }],
            total: 1,
            page: 1,
            pageSize: 50,
            totalPages: 1,
          },
        })
      }
      throw new Error(`Unexpected API call: ${url}`)
    })

    const { result } = renderHook(() => useTemplateInstantiation({ open: true, onOpenChange: jest.fn() }))
    await act(async () => {
      jest.advanceTimersByTime(0)
      await flushPromises()
    })

    act(() => result.current.setTemplateSearch('stale'))
    expect(result.current.templates).toEqual([])
    await act(async () => {
      jest.advanceTimersByTime(200)
      await flushPromises()
    })
    expect(staleSearchSignal).toBeDefined()

    act(() => result.current.setTemplateSearch('fresh'))
    expect(staleSearchSignal?.aborted).toBe(true)
    expect(result.current.templates).toEqual([])
    await act(async () => {
      jest.advanceTimersByTime(200)
      await flushPromises()
    })

    expect(result.current.templates).toEqual([expect.objectContaining({ name: 'Fresh template' })])
    expect(result.current.loadError).toBeNull()
  })

  it('retries a failed template list request and recovers in the same dialog', async () => {
    let attempts = 0
    apiCallMock.mockImplementation((url: string) => {
      if (url !== TEMPLATE_LIST_URL) throw new Error(`Unexpected API call: ${url}`)
      attempts += 1
      if (attempts === 1) return Promise.reject(new Error('temporarily unavailable'))
      return Promise.resolve({
        ok: true,
        result: { items: [templateRecord(1)], total: 1, page: 1, pageSize: 50, totalPages: 1 },
      })
    })

    const { result } = renderHook(() => useTemplateInstantiation({ open: true, onOpenChange: jest.fn() }))
    await act(async () => {
      jest.advanceTimersByTime(0)
      await flushPromises()
    })
    expect(result.current.loadError).toBe('documents.templates.instantiate.error.load')

    act(() => result.current.retryTemplates())
    expect(result.current.isLoading).toBe(true)
    await act(async () => {
      jest.advanceTimersByTime(0)
      await flushPromises()
    })

    expect(result.current.loadError).toBeNull()
    expect(result.current.templates).toEqual([expect.objectContaining({ name: 'Template 1' })])
    expect(attempts).toBe(2)
  })
})
