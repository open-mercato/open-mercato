"use client"
import * as React from 'react'
import { reportDevRuntimeError } from '@open-mercato/shared/lib/dev-runtime/report'

function isChunkLoadFailure(message: string): boolean {
  const haystack = message.toLowerCase()
  return haystack.includes('chunkloaderror')
    || haystack.includes('loading chunk')
    || haystack.includes('loading css chunk')
}

/**
 * Browser noise that is not a failure, and must not raise the diagnostics banner.
 *
 * `ResizeObserver loop …` is fired BY SPEC when an observer callback changes layout that the same
 * observer watches — which every chart, virtualised table and auto-sizing editor does on its first
 * paint. Nothing is broken, nothing is lost, and the browser has already recovered by the time the
 * event arrives; there is no action for the message to suggest.
 *
 * Surfacing it anyway has two costs. A developer is told the runtime is degraded on an ordinary page
 * and learns to dismiss the banner, which is the one thing that must never happen to an alert that
 * also reports chunk-load failures and uncaught exceptions. And the banner is rendered over the page,
 * so a Playwright spec on any screen holding a chart can lose a click to it — a failure that looks
 * like a product defect and reproduces nowhere near the code that caused it.
 */
function isBenignBrowserNoise(message: string): boolean {
  const haystack = message.toLowerCase()
  return haystack.includes('resizeobserver loop')
}

/**
 * Dev-only client island that forwards uncaught browser failures to the local
 * supervisor. It registers bounded listeners only, adds no context provider,
 * and stays silent when the collector token is absent (production, CI, or
 * diagnostics disabled).
 */
export function DevRuntimeReporter() {
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const handleError = (event: ErrorEvent) => {
      const message = event.message ?? ''
      if (isBenignBrowserNoise(message)) return
      reportDevRuntimeError({
        kind: isChunkLoadFailure(message) ? 'chunk-load-error' : 'window-error',
        error: event.error,
        message: message || undefined,
      })
    }

    const handleRejection = (event: PromiseRejectionEvent) => {
      reportDevRuntimeError({ kind: 'unhandled-rejection', error: event.reason })
    }

    window.addEventListener('error', handleError)
    window.addEventListener('unhandledrejection', handleRejection)
    return () => {
      window.removeEventListener('error', handleError)
      window.removeEventListener('unhandledrejection', handleRejection)
    }
  }, [])

  return null
}

export default DevRuntimeReporter
