"use client"

import * as React from 'react'
import { apiCall } from '../utils/apiCall'
import {
  createWidgetDataBatcher,
  type WidgetDataBatchResultEntry,
  type WidgetDataBatchSender,
} from './widgetDataBatcher'

const SINGLE_ENDPOINT = '/api/dashboards/widgets/data'
const BATCH_ENDPOINT = '/api/dashboards/widgets/data/batch'


export type WidgetDataFetcher = <TResponse>(request: unknown) => Promise<TResponse>

function readError(result: unknown, fallback: string): string {
  const errorMsg = (result as Record<string, unknown> | null)?.error
  return typeof errorMsg === 'string' ? errorMsg : fallback
}

/**
 * Fallback used when a widget renders outside a {@link WidgetDataBatchProvider}
 * (e.g. a standalone preview). Issues a single un-batched request so widgets
 * keep working without the dashboard host.
 */
const singleWidgetDataFetch: WidgetDataFetcher = async (request) => {
  const call = await apiCall(SINGLE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  if (!call.ok) {
    throw new Error(readError(call.result, 'Failed to fetch widget data'))
  }
  return call.result as never
}

const WidgetDataContext = React.createContext<WidgetDataFetcher>(singleWidgetDataFetch)

const batchSender: WidgetDataBatchSender = async (entries) => {
  const call = await apiCall<{ results?: WidgetDataBatchResultEntry[] }>(BATCH_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: entries }),
  })
  if (!call.ok || !call.result || !Array.isArray(call.result.results)) {
    throw new Error(readError(call.result, 'Failed to fetch widget data'))
  }
  return call.result.results
}

export type WidgetDataBatchProviderProps = {
  children: React.ReactNode
  windowMs?: number
  maxBatchSize?: number
}

/**
 * Provides a batched widget-data fetcher to descendant dashboard widgets.
 * Requests fired within a short window collapse into one POST to the batch
 * endpoint, so a first dashboard render issues a single authenticated request
 * instead of one per widget (see #2273).
 */
export function WidgetDataBatchProvider({
  children,
  windowMs,
  maxBatchSize,
}: WidgetDataBatchProviderProps): React.ReactElement {
  const batcher = React.useMemo(
    () => createWidgetDataBatcher({ send: batchSender, windowMs, maxBatchSize }),
    [windowMs, maxBatchSize],
  )
  const fetcher = React.useCallback<WidgetDataFetcher>(
    (request) => batcher.fetch(request),
    [batcher],
  )
  return <WidgetDataContext.Provider value={fetcher}>{children}</WidgetDataContext.Provider>
}

/** Returns the active widget-data fetcher (batched when inside a provider). */
export function useWidgetData(): WidgetDataFetcher {
  return React.useContext(WidgetDataContext)
}
