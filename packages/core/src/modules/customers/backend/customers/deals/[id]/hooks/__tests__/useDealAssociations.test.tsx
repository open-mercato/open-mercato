/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useDealAssociations } from '../useDealAssociations'
import type { DealDetailPayload } from '../types'

const surfaceRecordConflictMock = jest.fn()
const flashMock = jest.fn()

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: (...args: unknown[]) => surfaceRecordConflictMock(...args),
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => flashMock(...args),
}))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))
jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  updateCrud: jest.fn(async () => ({})),
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: jest.fn(async () => ({ items: [] })),
  withScopedApiRequestHeaders: (_headers: unknown, run: () => Promise<unknown>) => run(),
}))
jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: () => ({}),
}))

type HookOptions = Parameters<typeof useDealAssociations>[0]
const updateCrudMock = jest.mocked(updateCrud)
const runMutationWithContext: HookOptions['runMutationWithContext'] = async (operation) => operation()

const baseData: DealDetailPayload = {
  deal: {
    id: 'deal-1', title: 'Deal', description: null, status: null,
    pipelineStage: null, pipelineId: null, pipelineStageId: null,
    valueAmount: null, valueCurrency: null, probability: null,
    expectedCloseAt: null, ownerUserId: null, source: null,
    closureOutcome: null, lossReasonId: null, lossNotes: null,
    organizationId: 'org-1', tenantId: 'tenant-1',
    createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z',
  },
  people: [{ id: 'person-1', label: 'Ada Lovelace', subtitle: null, kind: 'person' }],
  companies: [{ id: 'company-1', label: 'Acme', subtitle: null, kind: 'company' }],
  linkedPersonIds: ['person-1'],
  linkedCompanyIds: ['company-1'],
  counts: { people: 1, companies: 1 },
  customFields: {}, viewer: null, pipelineStages: [], pipelineName: null,
  stageTransitions: [], owner: null,
}

const associationCases = [
  {
    kind: 'people', handler: 'handlePeopleAssociationsChange', editorIds: 'peopleEditorIds',
    saving: 'peopleSaving', payloadKey: 'personIds', previousId: 'person-1', nextId: 'person-2',
    fallback: 'Failed to update linked people.',
  },
  {
    kind: 'companies', handler: 'handleCompaniesAssociationsChange', editorIds: 'companiesEditorIds',
    saving: 'companiesSaving', payloadKey: 'companyIds', previousId: 'company-1', nextId: 'company-2',
    fallback: 'Failed to update linked companies.',
  },
] as const

beforeEach(() => {
  jest.clearAllMocks()
  surfaceRecordConflictMock.mockReturnValue(false)
})

describe.each(associationCases)('useDealAssociations — $kind', (association) => {
  function renderAssociations() {
    const setData = jest.fn()
    const onRefresh = jest.fn()
    const hook = renderHook(() => useDealAssociations({
      currentDealId: 'deal-1', data: baseData, setData, runMutationWithContext, onRefresh,
    }))
    return { ...hook, setData, onRefresh }
  }

  test('surfaces the server refusal, rolls back, and rejects with the original error', async () => {
    const refusal = createCrudFormError('Contact must belong to the deal company.', undefined, { status: 422 })
    updateCrudMock.mockRejectedValueOnce(refusal)
    const { result, setData, onRefresh } = renderAssociations()

    await act(async () => {
      await expect(result.current[association.handler]([association.nextId])).rejects.toBe(refusal)
    })

    expect(updateCrudMock).toHaveBeenCalledWith('customers/deals', {
      id: 'deal-1', [association.payloadKey]: [association.nextId],
    })
    expect(flashMock).toHaveBeenCalledWith(refusal.message, 'error')
    expect(flashMock).toHaveBeenCalledTimes(1)
    expect(result.current[association.editorIds]).toEqual([association.previousId])
    expect(result.current[association.saving]).toBe(false)
    expect(setData.mock.calls[0][0](baseData)).toEqual(baseData)
    expect(onRefresh).not.toHaveBeenCalled()
  })

  test.each([new Error(''), { status: 500 }])('uses the translated fallback when no Error message is available (%p)', async (failure) => {
    updateCrudMock.mockRejectedValueOnce(failure)
    const { result } = renderAssociations()

    await act(async () => {
      await expect(result.current[association.handler]([association.nextId])).rejects.toBe(failure)
    })

    expect(flashMock).toHaveBeenCalledWith(association.fallback, 'error')
    expect(result.current[association.editorIds]).toEqual([association.previousId])
    expect(result.current[association.saving]).toBe(false)
  })

  test('preserves conflict handling without flashing another error', async () => {
    const conflict = createCrudFormError('Record changed.', undefined, { status: 409 })
    surfaceRecordConflictMock.mockReturnValue(true)
    updateCrudMock.mockRejectedValueOnce(conflict)
    const { result, onRefresh } = renderAssociations()

    await act(async () => {
      await expect(result.current[association.handler]([association.nextId])).rejects.toBe(conflict)
    })

    expect(surfaceRecordConflictMock).toHaveBeenCalledWith(conflict, expect.any(Function), { onRefresh })
    expect(flashMock).not.toHaveBeenCalled()
    expect(result.current[association.editorIds]).toEqual([association.previousId])
    expect(result.current[association.saving]).toBe(false)
  })

  test('refreshes after a successful update', async () => {
    const { result, onRefresh, setData } = renderAssociations()

    await act(async () => {
      await result.current[association.handler]([association.nextId])
    })

    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(setData).not.toHaveBeenCalled()
    expect(result.current[association.editorIds]).toEqual([association.nextId])
    expect(result.current[association.saving]).toBe(false)
    expect(flashMock).not.toHaveBeenCalled()
  })
})
