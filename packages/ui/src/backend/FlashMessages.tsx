"use client"
import * as React from 'react'
import { Alert, type AlertStatus } from '../primitives/alert'

export type FlashKind = 'success' | 'error' | 'warning' | 'info'

const flashKindToAlertStatus: Record<FlashKind, AlertStatus> = {
  success: 'success',
  error: 'error',
  warning: 'warning',
  info: 'information',
}

function normalizeFlashKind(value: string | null | undefined): FlashKind {
  if (value && Object.prototype.hasOwnProperty.call(flashKindToAlertStatus, value)) {
    return value as FlashKind
  }
  return 'success'
}

// A URL-supplied flash is only trustworthy when the navigation that carried it
// originated from the same origin (an in-app POST->GET redirect or client-side
// navigation). Cross-origin links — the phishing/content-spoofing vector — must
// not be allowed to render attacker-controlled copy inside an authoritative banner.
function isSameOriginFlashNavigation(): boolean {
  if (typeof window === 'undefined') return false
  const referrer = document.referrer
  // No referrer (direct load, bookmark, or referrer stripped) is ambiguous, not a
  // cross-origin redirect we can attribute to an attacker page; allow it.
  if (!referrer) return true
  try {
    return new URL(referrer).origin === window.location.origin
  } catch {
    return false
  }
}

// Programmatic API to show a flash message without navigation.
// Consumers can import { flash } and call flash('text', 'error').
export function flash(message: string, type: FlashKind = 'info') {
  if (typeof window === 'undefined') return
  const evt = new CustomEvent('flash', { detail: { message, type } })
  window.dispatchEvent(evt)
}

// Two hosts mount `<FlashMessages />` over the same page: `FrontendLayout`
// wraps the entire app (backend routes included, via `AppProviders`) and
// `AppShell` mounts its own copy inside `<main>`. Both listen to the same
// `flash` event, so every backend toast rendered twice — two stacked fixed
// overlays, each with its own dismiss button, so dismissing one left the other
// behind. Both mount points are public surfaces third-party apps rely on, so
// instead of deleting one, only the first host to mount renders; the others
// keep their state in sync and take over if it unmounts.
const mountedFlashHostIds: symbol[] = []
const flashHostListeners = new Set<() => void>()

function notifyFlashHostListeners() {
  for (const listener of flashHostListeners) listener()
}

function subscribeFlashHosts(listener: () => void): () => void {
  flashHostListeners.add(listener)
  return () => {
    flashHostListeners.delete(listener)
  }
}

function getPrimaryFlashHostId(): symbol | null {
  return mountedFlashHostIds[0] ?? null
}

function getServerFlashHostId(): symbol | null {
  return null
}

function useIsPrimaryFlashHost(): boolean {
  const hostIdRef = React.useRef<symbol | null>(null)
  if (hostIdRef.current === null) hostIdRef.current = Symbol('om-flash-host')
  const hostId = hostIdRef.current

  React.useEffect(() => {
    mountedFlashHostIds.push(hostId)
    notifyFlashHostListeners()
    return () => {
      const index = mountedFlashHostIds.indexOf(hostId)
      if (index >= 0) mountedFlashHostIds.splice(index, 1)
      notifyFlashHostListeners()
    }
  }, [hostId])

  return React.useSyncExternalStore(subscribeFlashHosts, getPrimaryFlashHostId, getServerFlashHostId) === hostId
}

type HistoryMethod = History['pushState']

function useLocationKey() {
  const [locationKey, setLocationKey] = React.useState(() => {
    if (typeof window === 'undefined') return ''
    return window.location.href
  })
  const locationKeyRef = React.useRef(locationKey)

  React.useEffect(() => {
    locationKeyRef.current = locationKey
  }, [locationKey])

  React.useEffect(() => {
    if (typeof window === 'undefined') return

    let active = true
    const scheduleUpdate = (href: string) => {
      const run = () => {
        if (!active) return
        if (locationKeyRef.current === href) return
        locationKeyRef.current = href
        setLocationKey(href)
      }
      if (typeof queueMicrotask === 'function') {
        queueMicrotask(run)
      } else {
        setTimeout(run, 0)
      }
    }
    const updateLocation = () => {
      if (!active) return
      const href = window.location.href
      if (href === locationKeyRef.current) return
      scheduleUpdate(href)
    }

    const deferredUpdateLocation = () => {
      setTimeout(updateLocation, 0)
    }

    const originalPush: HistoryMethod = window.history.pushState.bind(window.history)
    const originalReplace: HistoryMethod = window.history.replaceState.bind(window.history)

    const pushState: HistoryMethod = (...args) => {
      originalPush(...args)
      deferredUpdateLocation()
    }

    const replaceState: HistoryMethod = (...args) => {
      originalReplace(...args)
      deferredUpdateLocation()
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
  const isPrimaryHost = useIsPrimaryFlashHost()
  const locationKey = useLocationKey()
  const dismissTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearDismissTimer = React.useCallback(() => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current)
      dismissTimerRef.current = null
    }
  }, [])

  const showFlash = React.useCallback((message: string, type: FlashKind) => {
    clearDismissTimer()
    setMsg(message)
    setKind(type)
    dismissTimerRef.current = setTimeout(() => {
      dismissTimerRef.current = null
      setMsg(null)
    }, 3000)
  }, [clearDismissTimer])

  React.useEffect(() => {
    return () => {
      clearDismissTimer()
    }
  }, [clearDismissTimer])

  // Read flash from URL on any navigation change (client-side too)
  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    const message = url.searchParams.get('flash')
    const type = normalizeFlashKind(url.searchParams.get('type'))
    if (message) {
      // Always strip the params so a spoofed link does not linger in history,
      // but only render the banner for same-origin navigations.
      const trusted = isSameOriginFlashNavigation()
      url.searchParams.delete('flash')
      url.searchParams.delete('type')
      window.history.replaceState({}, '', url.toString())
      if (trusted) {
        showFlash(message, type)
      }
    }
  }, [locationKey, showFlash])

  // Listen for programmatic flash events
  React.useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ message?: string; type?: FlashKind }>
      const text = ce.detail?.message
      const t = ce.detail?.type || 'info'
      if (!text) return
      showFlash(text, t)
    }
    window.addEventListener('flash', handler as EventListener)
    return () => window.removeEventListener('flash', handler as EventListener)
  }, [showFlash])

  const handleDismiss = React.useCallback(() => {
    clearDismissTimer()
    setMsg(null)
  }, [clearDismissTimer])

  if (!msg || !isPrimaryHost) return null

  return (
    <div className="pointer-events-none fixed left-3 right-3 top-3 z-toast sm:left-auto sm:right-4 sm:w-[380px]">
      <div className="pointer-events-auto">
        <Alert
          status={flashKindToAlertStatus[kind]}
          size="sm"
          dismissible
          onDismiss={handleDismiss}
          className="shadow-md"
        >
          {msg}
        </Alert>
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
