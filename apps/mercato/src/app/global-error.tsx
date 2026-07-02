"use client"

import { Button } from '@open-mercato/ui/primitives/button'
import { useEffect, useState } from 'react'
import { reloadPage } from './global-error-reload'

export function isNetworkError(error: unknown): boolean {
  if (!error) return false
  const candidate = error as { name?: unknown; message?: unknown; code?: unknown }
  const name = typeof candidate.name === 'string' ? candidate.name : ''
  const message = typeof candidate.message === 'string' ? candidate.message : ''
  const code = typeof candidate.code === 'string' ? candidate.code : ''
  const haystack = `${name} ${message} ${code}`.toLowerCase()
  return (
    name === 'ChunkLoadError' ||
    haystack.includes('loading chunk') ||
    haystack.includes('loading css chunk') ||
    haystack.includes('failed to fetch') ||
    haystack.includes('networkerror') ||
    haystack.includes('err_internet_disconnected') ||
    haystack.includes('err_network_changed') ||
    haystack.includes('err_network') ||
    haystack.includes('network request failed')
  )
}

type GlobalErrorProps = {
  error: Error & { digest?: string }
  reset: () => void
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  const [isOffline, setIsOffline] = useState<boolean>(false)
  const networkError = isNetworkError(error)

  useEffect(() => {
    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
      setIsOffline(!navigator.onLine)
    }
    if (typeof window === 'undefined') return
    const handleOnline = () => {
      setIsOffline(false)
      if (networkError) {
        reloadPage()
      }
    }
    const handleOffline = () => setIsOffline(true)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [networkError])

  const showOfflineView = networkError || isOffline
  // Next.js global-error renders outside normal app providers, so these are provider-independent fallback strings.
  const title = showOfflineView ? 'You appear to be offline' : 'Something went wrong'
  const description = showOfflineView
    ? 'Unable to connect. Please check your internet connection and try again. This page will reload automatically when your connection is restored.'
    : 'An unexpected error occurred while rendering this page.'
  const buttonLabel = showOfflineView ? 'Retry now' : 'Try again'
  const handleRetry = () => {
    if (showOfflineView) {
      reloadPage()
      return
    }
    reset()
  }

  return (
    <html className="bg-background text-foreground">
      <body className="bg-background text-foreground">
        <main
          role="alert"
          aria-live="assertive"
          className="flex min-h-screen items-start justify-center bg-background px-6 py-16 text-foreground"
        >
          <div className="w-full max-w-xl space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm">
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            <p className="text-sm leading-6 text-muted-foreground">{description}</p>
            <Button type="button" onClick={handleRetry}>
              {buttonLabel}
            </Button>
          </div>
        </main>
      </body>
    </html>
  )
}
