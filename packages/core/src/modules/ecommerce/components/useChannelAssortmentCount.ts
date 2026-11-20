'use client'

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import {
  ASSORTMENT_COUNT_DEBOUNCE_MS,
  buildAssortmentCountUrl,
  type AssortmentCountDraft,
  type AssortmentCountResult,
} from './storeChannels'

export type AssortmentCountState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; result: AssortmentCountResult; refreshing: boolean }

function isCountResult(value: unknown): value is AssortmentCountResult {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.count === 'number' && typeof record.countWithoutAuthentication === 'number'
}

/**
 * Live product count for one channel binding. With a draft it asks for the unsaved scope and
 * require-authentication switch, debounced so typing in a picker sends one request per pause;
 * without a binding id (an unsaved binding) it stays idle. A changed `refreshKey` (the binding's
 * `updatedAt`) refetches the same URL, so a saved edit is reflected without a remount.
 */
export function useChannelAssortmentCount(
  bindingId: string | null,
  draft: AssortmentCountDraft | null,
  delayMs: number = ASSORTMENT_COUNT_DEBOUNCE_MS,
  refreshKey: string | null = null,
): AssortmentCountState {
  const url = bindingId ? buildAssortmentCountUrl(bindingId, draft) : null
  const [state, setState] = React.useState<AssortmentCountState>(() => (url ? { status: 'loading' } : { status: 'idle' }))

  React.useEffect(() => {
    if (!url) {
      setState({ status: 'idle' })
      return
    }
    let cancelled = false
    setState((previous) => (previous.status === 'ready' ? { ...previous, refreshing: true } : { status: 'loading' }))
    const timer = setTimeout(() => {
      void apiCall<AssortmentCountResult>(url, { cache: 'no-store' })
        .then((call) => {
          if (cancelled) return
          if (call.ok && isCountResult(call.result)) {
            setState({ status: 'ready', result: call.result, refreshing: false })
          } else {
            setState({ status: 'error' })
          }
        })
        .catch(() => {
          if (!cancelled) setState({ status: 'error' })
        })
    }, delayMs)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [delayMs, url, refreshKey])

  return state
}
