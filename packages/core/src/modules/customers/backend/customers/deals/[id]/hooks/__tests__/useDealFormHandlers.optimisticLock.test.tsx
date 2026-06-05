/** @jest-environment jsdom */

import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

const updateCrudMock = jest.fn()
const deleteCrudMock = jest.fn()
const scopedHeaderCalls: Array<Record<string, string>> = []

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  updateCrud: (...args: unknown[]) => updateCrudMock(...args),
  deleteCrud: (...args: unknown[]) => deleteCrudMock(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  withScopedApiRequestHeaders: <T,>(headers: Record<string, string>, run: () => Promise<T>) => {
    scopedHeaderCalls.push(headers)
    return run()
  },
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}))

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({ useConfirmDialog: () => ({ confirm: jest.fn() }) }))

import { act, renderHook } from '@testing-library/react'
import { useDealFormHandlers } from '../useDealFormHandlers'
import type { DealDetailPayload } from '../types'

const UPDATED_AT = '2026-05-28T08:42:18.123Z'

function buildData(): DealDetailPayload {
  return {
    deal: {
      id: 'deal-1',
      title: 'Big deal',
      description: null,
      status: 'open',
      pipelineStage: null,
      pipelineId: null,
      pipelineStageId: null,
      valueAmount: null,
      valueCurrency: null,
      probability: null,
      expectedCloseAt: null,
      ownerUserId: null,
      source: null,
      closureOutcome: null,
      lossReasonId: null,
      lossNotes: null,
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      createdAt: '2026-05-28T08:00:00.000Z',
      updatedAt: UPDATED_AT,
    },
    people: [],
    companies: [],
    linkedPersonIds: [],
    linkedCompanyIds: [],
    counts: { people: 0, companies: 0 },
    customFields: {},
    viewer: null,
    pipelineStages: [],
    pipelineName: null,
    stageTransitions: [],
    owner: null,
  }
}

describe('useDealFormHandlers — optimistic-lock header wiring', () => {
  beforeEach(() => {
    updateCrudMock.mockReset().mockResolvedValue({ ok: true })
    deleteCrudMock.mockReset().mockResolvedValue({ ok: true })
    scopedHeaderCalls.length = 0
  })

  it('sends the expected updated_at header on deal update', async () => {
    const data = buildData()
    const { result } = renderHook(() =>
      useDealFormHandlers({
        data,
        currentDealId: data.deal.id,
        loadData: async () => {},
        runMutationWithContext: (op) => op(),
        formWrapperRef: { current: null },
        confirm: jest.fn(async () => true),
      }),
    )

    await act(async () => {
      await result.current.handleFormSubmit({ base: { title: 'Bigger deal' }, custom: {} } as never)
    })

    expect(updateCrudMock).toHaveBeenCalledTimes(1)
    expect(scopedHeaderCalls).toContainEqual({ [OPTIMISTIC_LOCK_HEADER_NAME]: UPDATED_AT })
  })

  it('sends the expected updated_at header on deal delete', async () => {
    const data = buildData()
    const { result } = renderHook(() =>
      useDealFormHandlers({
        data,
        currentDealId: data.deal.id,
        loadData: async () => {},
        runMutationWithContext: (op) => op(),
        formWrapperRef: { current: null },
        confirm: jest.fn(async () => true),
      }),
    )

    await act(async () => {
      await result.current.handleDelete()
    })

    expect(deleteCrudMock).toHaveBeenCalledTimes(1)
    expect(scopedHeaderCalls).toContainEqual({ [OPTIMISTIC_LOCK_HEADER_NAME]: UPDATED_AT })
  })
})
