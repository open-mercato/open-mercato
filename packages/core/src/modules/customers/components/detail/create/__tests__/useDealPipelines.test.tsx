/**
 * @jest-environment jsdom
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { useDealPipelines } from '../useDealPipelines'

type StagesResponse = { ok: boolean; result: { items: Array<{ id: string; label: string; order: number }> } }

const mockApiCall = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}))

function stagesResponse(id: string): StagesResponse {
  return { ok: true, result: { items: [{ id, label: id, order: 0 }] } }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

describe('useDealPipelines', () => {
  const pending = new Map<string, ReturnType<typeof deferred<StagesResponse>>>()

  beforeEach(() => {
    pending.clear()
    mockApiCall.mockReset()
    mockApiCall.mockImplementation((url: string) => {
      if (url === '/api/customers/pipelines') return Promise.resolve({ ok: true, result: { items: [] } })
      const pipelineId = new URL(url, 'http://localhost').searchParams.get('pipelineId') ?? ''
      const entry = deferred<StagesResponse>()
      pending.set(pipelineId, entry)
      return entry.promise
    })
  })

  it('clears the previous pipeline stages as soon as another pipeline is requested', async () => {
    const { result } = renderHook(() => useDealPipelines())
    await act(async () => {
      const load = result.current.loadStages('first')
      pending.get('first')?.resolve(stagesResponse('first-stage'))
      await load
    })
    expect(result.current.stages.map((stage) => stage.id)).toEqual(['first-stage'])

    await act(async () => {
      void result.current.loadStages('second')
    })

    expect(result.current.stages).toEqual([])
  })

  it('ignores a slower response from a pipeline that is no longer selected', async () => {
    const { result } = renderHook(() => useDealPipelines())
    let firstLoad: Promise<void> = Promise.resolve()
    let secondLoad: Promise<void> = Promise.resolve()
    await act(async () => {
      firstLoad = result.current.loadStages('first')
      secondLoad = result.current.loadStages('second')
    })
    await act(async () => {
      pending.get('second')?.resolve(stagesResponse('second-stage'))
      await secondLoad
    })
    await act(async () => {
      pending.get('first')?.resolve(stagesResponse('first-stage'))
      await firstLoad
    })

    await waitFor(() => expect(result.current.stages.map((stage) => stage.id)).toEqual(['second-stage']))
  })
})
