"use client"

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
    <html>
      <body>
        <main
          role="alert"
          aria-live="assertive"
          style={{
            padding: '2rem',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            maxWidth: '36rem',
            margin: '4rem auto',
          }}
        >
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>{title}</h1>
          <p style={{ marginBottom: '1.5rem', color: '#4b5563', lineHeight: 1.5 }}>{description}</p>
          <button
            type="button"
            onClick={handleRetry}
            style={{
              padding: '0.5rem 1.25rem',
              fontSize: '1rem',
              fontWeight: 500,
              background: '#111827',
              color: '#ffffff',
              border: 'none',
              borderRadius: '0.375rem',
              cursor: 'pointer',
            }}
          >
            {buttonLabel}
          </button>
        </main>
      </body>
    </html>
  )
}
