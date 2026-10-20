import * as React from 'react'
import { buildExplainQuery, fetchExplanation, isAbortError } from './explainApi'
import type { ExplainFieldResponse, ExplainOverviewResponse, ExplainRequestParams } from './types'
import { isExplainFieldResponse } from './types'

export type ExplanationState =
  | { status: 'loading' }
  | { status: 'not_found' }
  | { status: 'forbidden' }
  | { status: 'error' }
  | { status: 'ready'; body: ExplainFieldResponse | ExplainOverviewResponse }

type KeyedExplanationState = { key: string | null; state: ExplanationState }

const LOADING_STATE: ExplanationState = { status: 'loading' }

export type OlderPagesStatus = 'idle' | 'loading' | 'error'

export type UseExplanationResult = {
  state: ExplanationState
  retry: () => void
  olderPages: ExplainFieldResponse[]
  olderStatus: OlderPagesStatus
  nextBefore: string | null
  loadOlder: () => void
}

function readNextBefore(body: ExplainFieldResponse): string | null {
  return typeof body.page?.nextBefore === 'string' && body.page.nextBefore.length > 0 ? body.page.nextBefore : null
}

export function useExplanation(request: ExplainRequestParams | null): UseExplanationResult {
  const requestKey = request ? buildExplainQuery({ ...request, before: null }) : null
  const requestRef = React.useRef(request)
  const [keyedState, setKeyedState] = React.useState<KeyedExplanationState>({ key: null, state: LOADING_STATE })
  const [attempt, setAttempt] = React.useState(0)
  const [olderPages, setOlderPages] = React.useState<ExplainFieldResponse[]>([])
  const [olderStatus, setOlderStatus] = React.useState<OlderPagesStatus>('idle')
  const olderControllerRef = React.useRef<AbortController | null>(null)

  React.useEffect(() => {
    requestRef.current = request
  })

  React.useEffect(() => {
    const current = requestRef.current
    olderControllerRef.current?.abort()
    olderControllerRef.current = null
    setOlderPages([])
    setOlderStatus('idle')
    if (!requestKey || !current) {
      setKeyedState({ key: requestKey, state: { status: 'not_found' } })
      return
    }
    const controller = new AbortController()
    const settle = (next: ExplanationState) => {
      if (!controller.signal.aborted) setKeyedState({ key: requestKey, state: next })
    }
    setKeyedState({ key: requestKey, state: LOADING_STATE })
    fetchExplanation({ ...current, before: null }, controller.signal)
      .then((outcome) => {
        if (outcome.status === 'ok') settle({ status: 'ready', body: outcome.body })
        else if (outcome.status === 'not_found') settle({ status: 'not_found' })
        else if (outcome.status === 'forbidden') settle({ status: 'forbidden' })
        else settle({ status: 'error' })
      })
      .catch((error: unknown) => {
        if (isAbortError(error)) return
        settle({ status: 'error' })
      })
    return () => {
      controller.abort()
    }
  }, [requestKey, attempt])

  React.useEffect(() => () => {
    olderControllerRef.current?.abort()
  }, [])

  const state = keyedState.key === requestKey ? keyedState.state : LOADING_STATE
  const firstPage = state.status === 'ready' && isExplainFieldResponse(state.body) ? state.body : null
  const lastPage = firstPage && olderPages.length > 0 ? olderPages[olderPages.length - 1] : firstPage
  const nextBefore = lastPage ? readNextBefore(lastPage) : null

  const loadOlder = React.useCallback(() => {
    const current = requestRef.current
    if (!current || !nextBefore || olderControllerRef.current) return
    const controller = new AbortController()
    olderControllerRef.current = controller
    setOlderStatus('loading')
    fetchExplanation({ ...current, before: nextBefore }, controller.signal)
      .then((outcome) => {
        if (controller.signal.aborted) return
        if (outcome.status === 'ok' && isExplainFieldResponse(outcome.body)) {
          const page = outcome.body
          setOlderPages((pages) => [...pages, page])
          setOlderStatus('idle')
        } else {
          setOlderStatus('error')
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return
        setOlderStatus('error')
      })
      .finally(() => {
        if (olderControllerRef.current === controller) olderControllerRef.current = null
      })
  }, [nextBefore])

  const retry = React.useCallback(() => {
    setAttempt((value) => value + 1)
  }, [])

  return { state, retry, olderPages, olderStatus, nextBefore, loadOlder }
}
