"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import {
  SIMULATION_API_BASE,
  SIMULATION_CAPABILITIES_API_PATH,
  SIMULATION_DECISION_RESOURCE_KIND,
  SIMULATION_POLL_INTERVAL_MS,
  SIMULATION_RUN_RESOURCE_KIND,
  isAbortError,
  isActiveSimulationStatus,
  isSimulationRunId,
  readSimulationError,
  simulationListApiPath,
  simulationRecordsApiPath,
  simulationRunApiPath,
} from './api'
import type {
  SimulationCancelResponse,
  SimulationCapabilities,
  SimulationDecisionResponse,
  SimulationDecisionValue,
  SimulationListResponse,
  SimulationRecordsResponse,
  SimulationRequestBody,
  SimulationRequestError,
  SimulationRequestResponse,
  SimulationRequestResult,
  SimulationRunDetail,
  SimulationRunResponse,
} from './types'

const JSON_HEADERS = { 'content-type': 'application/json' }

/** A best-effort read: a 403 means "not available here", never the global access-denied banner. */
const OPTIONAL_LOOKUP_HEADERS = { 'x-om-forbidden-redirect': '0' }

const UNKNOWN_ERROR: SimulationRequestError = { httpStatus: null, code: null, message: null, issues: [] }

/** Calls a simulation read endpoint through `apiCall` (never raw fetch); aborts reject with the `AbortError`. */
export async function simulationRequest<TBody>(url: string, init?: RequestInit): Promise<SimulationRequestResult<TBody>> {
  const call = await apiCall<TBody>(url, init)
  if (call.ok && call.result !== null && call.result !== undefined) return { ok: true, body: call.result }
  return { ok: false, error: readSimulationError(call.status || null, call.result) }
}

export type SimulationResourceState<TBody> = {
  data: TBody | null
  error: SimulationRequestError | null
  loading: boolean
  reload: () => void
}

type ResourceSnapshot<TBody> = { url: string | null; data: TBody | null; error: SimulationRequestError | null }

type ResourceOptions<TBody> = {
  init?: RequestInit
  /** Fetch again after `SIMULATION_POLL_INTERVAL_MS` while this returns true for the latest body. */
  pollWhile?: (body: TBody) => boolean
}

/**
 * A failed poll is retried while the last data still asks for polling, unless the server answered
 * a definite client error (the run is gone or no longer readable); rate limits are retried.
 */
function isRetryablePollError(error: SimulationRequestError): boolean {
  const status = error.httpStatus
  return status === null || status === 429 || status >= 500
}

/**
 * Loads one simulation read endpoint: a `null` url loads nothing, a new url (or `reload`) aborts the
 * request in flight. Polls keep the shown data while they load; a failed poll keeps the last data
 * next to the error and keeps polling while that data still asks for it.
 */
function useSimulationResource<TBody>(url: string | null, options: ResourceOptions<TBody> = {}): SimulationResourceState<TBody> {
  const [snapshot, setSnapshot] = React.useState<ResourceSnapshot<TBody>>({ url: null, data: null, error: null })
  const [pendingUrl, setPendingUrl] = React.useState<string | null>(url)
  const [version, setVersion] = React.useState(0)
  const lastBodyRef = React.useRef<{ url: string | null; body: TBody | null }>({ url: null, body: null })
  const optionsRef = React.useRef(options)
  React.useEffect(() => {
    optionsRef.current = options
  })

  React.useEffect(() => {
    if (!url) {
      setSnapshot({ url: null, data: null, error: null })
      setPendingUrl(null)
      return
    }
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | null = null
    const schedulePoll = () => {
      timer = setTimeout(() => setVersion((value) => value + 1), SIMULATION_POLL_INTERVAL_MS)
    }
    const handleFailure = (error: SimulationRequestError) => {
      setSnapshot((previous) => ({ url, data: previous.url === url ? previous.data : null, error }))
      const last = lastBodyRef.current
      if (last.url === url && last.body !== null && isRetryablePollError(error) && optionsRef.current.pollWhile?.(last.body)) schedulePoll()
    }
    setPendingUrl(url)
    simulationRequest<TBody>(url, { ...(optionsRef.current.init ?? {}), signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return
        if (result.ok) {
          lastBodyRef.current = { url, body: result.body }
          setSnapshot({ url, data: result.body, error: null })
          if (optionsRef.current.pollWhile?.(result.body)) schedulePoll()
        } else {
          handleFailure(result.error)
        }
        setPendingUrl(null)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        handleFailure(UNKNOWN_ERROR)
        setPendingUrl(null)
      })
    return () => {
      controller.abort()
      if (timer) clearTimeout(timer)
    }
  }, [url, version])

  const current = snapshot.url === url
  const data = current ? snapshot.data : null
  const error = current ? snapshot.error : null
  const loading = url !== null && data === null && error === null && (pendingUrl !== null || !current)
  const reload = React.useCallback(() => setVersion((value) => value + 1), [])
  return { data, error, loading, reload }
}

/** Kinds the viewer may run in the selected organization and the run limits (`null` url = nothing loaded). */
export function useSimulationCapabilities(enabled = true): SimulationResourceState<SimulationCapabilities> {
  return useSimulationResource<SimulationCapabilities>(enabled ? SIMULATION_CAPABILITIES_API_PATH : null, {
    init: { headers: OPTIONAL_LOOKUP_HEADERS },
  })
}

/** One page of the viewer's own runs, newest first. */
export function useSimulationRuns(page: number): SimulationResourceState<SimulationListResponse> {
  return useSimulationResource<SimulationListResponse>(simulationListApiPath(page))
}

export type SimulationRunState = SimulationResourceState<SimulationRunDetail>

function isRunStillActive(body: SimulationRunResponse): boolean {
  return isActiveSimulationStatus(body.result?.status)
}

/**
 * One of the viewer's own runs (`null` id or an id that is not a UUID loads nothing). With
 * `poll`, it is fetched again every 2 s while the run is queued or running.
 */
export function useSimulationRun(runId: string | null, options: { poll?: boolean } = {}): SimulationRunState {
  const poll = options.poll === true
  const url = isSimulationRunId(runId) ? simulationRunApiPath(runId) : null
  const resource = useSimulationResource<SimulationRunResponse>(url, { pollWhile: poll ? isRunStillActive : undefined })
  return { data: resource.data?.result ?? null, error: resource.error, loading: resource.loading, reload: resource.reload }
}

/**
 * One page of the live records of one of the viewer's own completed runs (resolved by the owning
 * module on every read; `null` id or `enabled: false` loads nothing).
 */
export function useSimulationLiveRecords(
  runId: string | null,
  page: number,
  options: { enabled?: boolean; pageSize?: number } = {},
): SimulationResourceState<SimulationRecordsResponse> {
  const enabled = options.enabled !== false
  const url = enabled && isSimulationRunId(runId) ? simulationRecordsApiPath(runId, page, options.pageSize) : null
  return useSimulationResource<SimulationRecordsResponse>(url)
}

/** A one-off read of one of the viewer's own runs (e.g. to load its proposal into a form). */
export async function fetchSimulationRun(runId: string, signal?: AbortSignal): Promise<SimulationRequestResult<SimulationRunDetail>> {
  if (!isSimulationRunId(runId)) return { ok: false, error: { ...UNKNOWN_ERROR, httpStatus: 404, code: 'run_not_found' } }
  try {
    const result = await simulationRequest<SimulationRunResponse>(simulationRunApiPath(runId), signal ? { signal } : undefined)
    if (!result.ok) return result
    return result.body.result ? { ok: true, body: result.body.result } : { ok: false, error: UNKNOWN_ERROR }
  } catch (error) {
    if (isAbortError(error)) throw error
    return { ok: false, error: UNKNOWN_ERROR }
  }
}

export type SimulationDecisionOutcome = { ok: boolean; status: number | null; code: string | null }

/**
 * Records a decision for one of the viewer's own runs outside React (CrudForm `onAfterSave`
 * handlers, where the form save itself was the guarded mutation). Never throws: a failure is
 * returned (409 `decision_exists` when it was already recorded).
 */
export async function recordSimulationDecision(runId: string, decision: SimulationDecisionValue): Promise<SimulationDecisionOutcome> {
  if (!isSimulationRunId(runId)) return { ok: false, status: null, code: null }
  try {
    const call = await apiCall<SimulationDecisionResponse>(simulationRunApiPath(runId, 'decision'), {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ decision }),
    })
    if (call.ok) return { ok: true, status: call.status, code: null }
    const error = readSimulationError(call.status || null, call.result)
    return { ok: false, status: error.httpStatus, code: error.code }
  } catch {
    return { ok: false, status: null, code: null }
  }
}

type SimulationMutationContext = {
  formId: string
  resourceKind: string
  resourceId?: string
  retryLastMutation: () => Promise<boolean>
}

/**
 * The writes of the simulator UI, each through `useGuardedMutation` (global mutation guards,
 * record locks, conflict UI; `retryLastMutation` is part of the injection context): requesting a
 * run, cancelling one and recording a decision. Errors are thrown as `apiCallOrThrow` raises them
 * (read them with `readSimulationMutationError`).
 */
export function useSimulationMutations(contextId: string) {
  const t = useT()
  const { runMutation, retryLastMutation } = useGuardedMutation<SimulationMutationContext>({
    contextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const requestSimulation = React.useCallback(async (body: SimulationRequestBody): Promise<SimulationRequestResponse | null> => {
    const call = await runMutation({
      operation: () => apiCallOrThrow<SimulationRequestResponse>(SIMULATION_API_BASE, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      }),
      context: { formId: contextId, resourceKind: SIMULATION_RUN_RESOURCE_KIND, retryLastMutation },
      mutationPayload: { kind: body.kind, artifactId: body.artifactId ?? null },
    })
    return call.result && isSimulationRunId(call.result.runId) ? call.result : null
  }, [contextId, retryLastMutation, runMutation])

  const cancelRun = React.useCallback(async (runId: string): Promise<SimulationCancelResponse | null> => {
    const call = await runMutation({
      operation: () => apiCallOrThrow<SimulationCancelResponse>(simulationRunApiPath(runId, 'cancel'), {
        method: 'POST',
        headers: JSON_HEADERS,
        body: '{}',
      }),
      context: { formId: contextId, resourceKind: SIMULATION_RUN_RESOURCE_KIND, resourceId: runId, retryLastMutation },
      mutationPayload: { runId },
    })
    return call.result
  }, [contextId, retryLastMutation, runMutation])

  const decideRun = React.useCallback(async (runId: string, decision: SimulationDecisionValue): Promise<SimulationDecisionResponse | null> => {
    const call = await runMutation({
      operation: () => apiCallOrThrow<SimulationDecisionResponse>(simulationRunApiPath(runId, 'decision'), {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ decision }),
      }),
      context: { formId: contextId, resourceKind: SIMULATION_DECISION_RESOURCE_KIND, resourceId: runId, retryLastMutation },
      mutationPayload: { runId, decision },
    })
    return call.result
  }, [contextId, retryLastMutation, runMutation])

  return { requestSimulation, cancelRun, decideRun, retryLastMutation }
}
