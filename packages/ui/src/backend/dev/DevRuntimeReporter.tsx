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
