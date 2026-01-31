"use client"
import * as React from 'react'

export type FlashKind = 'success' | 'error' | 'warning' | 'info'

// Programmatic API to show a flash message without navigation.
// Consumers can import { flash } and call flash('text', 'error').
export function flash(message: string, type: FlashKind = 'info') {
  if (typeof window === 'undefined') return
  const evt = new CustomEvent('flash', { detail: { message, type } })
  window.dispatchEvent(evt)
}

type HistoryMethod = History['pushState']

function useLocationKey() {
  const [locationKey, setLocationKey] = React.useState(() => {
    if (typeof window === 'undefined') return ''
    return window.location.href
  })

  React.useEffect(() => {
    if (typeof window === 'undefined') return

    let active = true
    const updateLocation = () => {
      if (!active) return
      setLocationKey(window.location.href)
    }

    const originalPush: HistoryMethod = window.history.pushState.bind(window.history)
    const originalReplace: HistoryMethod = window.history.replaceState.bind(window.history)

    const pushState: HistoryMethod = (...args) => {
      originalPush(...args)
      updateLocation()
    }

    const replaceState: HistoryMethod = (...args) => {
      originalReplace(...args)
      updateLocation()
    }

    window.history.pushState = pushState
    window.history.replaceState = replaceState
    window.addEventListener('popstate', updateLocation)
    window.addEventListener('hashchange', updateLocation)
    updateLocation()

    return () => {
      active = false
      window.history.pushState = originalPush
      window.history.replaceState = originalReplace
      window.removeEventListener('popstate', updateLocation)
      window.removeEventListener('hashchange', updateLocation)
    }
  }, [])

  return locationKey
}

function FlashMessagesInner() {
  const [msg, setMsg] = React.useState<string | null>(null)
  const [kind, setKind] = React.useState<FlashKind>('info')
  const locationKey = useLocationKey()

  // Read flash from URL on any navigation change (client-side too)
  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    const message = url.searchParams.get('flash')
    const type = (url.searchParams.get('type') as FlashKind | null) || 'success'
    if (message) {
      setMsg(message)
      setKind(type)
      url.searchParams.delete('flash')
      url.searchParams.delete('type')
      window.history.replaceState({}, '', url.toString())
      const timer = setTimeout(() => setMsg(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [locationKey])

  // Listen for programmatic flash events
  React.useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ message?: string; type?: FlashKind }>
      const text = ce.detail?.message
      const t = ce.detail?.type || 'info'
      if (!text) return
      setMsg(text)
      setKind(t)
      const timer = setTimeout(() => setMsg(null), 3000)
      return () => clearTimeout(timer)
    }
    window.addEventListener('flash', handler as EventListener)
    return () => window.removeEventListener('flash', handler as EventListener)
  }, [])

  if (!msg) return null

  const color = kind === 'success' ? 'bg-emerald-600' : kind === 'error' ? 'bg-red-600' : kind === 'warning' ? 'bg-amber-500' : 'bg-blue-600'

  return (
    <div className="pointer-events-none fixed left-3 right-3 top-3 z-[1200] sm:left-auto sm:right-4 sm:w-[380px]">
      <div className={`pointer-events-auto rounded px-3 py-2 text-white shadow-md ${color}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm">{msg}</div>
          <button
            type="button"
            className="text-sm text-white/90 transition hover:text-white"
            onClick={() => setMsg(null)}
          >
            ×
          </button>
        </div>
      </div>
    </div>
  )
}

export function FlashMessages() {
  return (
    <React.Suspense fallback={null}>
      <FlashMessagesInner />
    </React.Suspense>
  )
}
