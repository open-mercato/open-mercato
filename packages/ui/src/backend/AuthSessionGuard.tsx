'use client'
import * as React from 'react'
import { apiCall } from './utils/apiCall'
import { clearAllPerspectiveState } from './perspectiveState'

export const AUTH_IDENTITY_STORAGE_KEY = 'om:auth:identity'
export const AUTH_IDENTITY_BROADCAST_CHANNEL = 'om-auth-identity'
export const AUTH_IDENTITY_USER_STORAGE_KEY = 'om:auth:identity:user'

/**
 * Purge browser-local DataTable perspective state whenever the backend renders for a
 * different user than the one it last rendered for (#4185).
 *
 * The login form also purges on submit, but that only fires when its client handler
 * runs: a form submitted before hydration, an SSO/magic-link return, or any other
 * entry point into the backend bypasses it entirely and the previous account's unsaved
 * column widths carry over. Anchoring the purge to the observed server identity covers
 * every route into the backend instead of one form.
 *
 * The last-seen id is recorded without purging (no stored id means nothing to leak
 * from), so an account's own unsaved widths still survive a plain reload.
 */
function purgePerspectiveStateOnIdentityChange(serverUserId: string | null): void {
  if (typeof window === 'undefined' || !serverUserId) return
  try {
    const lastSeenUserId = window.localStorage.getItem(AUTH_IDENTITY_USER_STORAGE_KEY)
    if (lastSeenUserId === serverUserId) return
    if (lastSeenUserId !== null) clearAllPerspectiveState()
    window.localStorage.setItem(AUTH_IDENTITY_USER_STORAGE_KEY, serverUserId)
  } catch {
    // private mode / quota errors are non-fatal
  }
}

type FeatureCheckResponse = {
  ok: boolean
  granted?: string[]
  userId?: string
}

export type AuthSessionGuardProps = {
  serverUserId: string | null
}

export const __reload = {
  fn: (): void => {
    if (typeof window !== 'undefined') window.location.reload()
  },
}

export function AuthSessionGuard({ serverUserId }: AuthSessionGuardProps) {
  React.useEffect(() => {
    if (typeof window === 'undefined') return
    purgePerspectiveStateOnIdentityChange(serverUserId)
    let cancelled = false
    let reloadScheduled = false

    const triggerReload = () => {
      if (reloadScheduled) return
      reloadScheduled = true
      __reload.fn()
    }

    const checkIdentity = async () => {
      if (cancelled || reloadScheduled) return
      try {
        const res = await apiCall<FeatureCheckResponse>('/api/auth/feature-check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ features: [] }),
          cache: 'no-store',
        })
        if (cancelled || reloadScheduled) return
        if (res.status === 401) {
          if (serverUserId) triggerReload()
          return
        }
        if (!res.ok) return
        const currentUserId = typeof res.result?.userId === 'string' ? res.result.userId : null
        if (!currentUserId) return
        if (currentUserId !== serverUserId) triggerReload()
      } catch {
        // network errors are ignored — next focus/storage event retries
      }
    }

    const onVisibilityOrFocus = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      void checkIdentity()
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key !== AUTH_IDENTITY_STORAGE_KEY) return
      void checkIdentity()
    }

    let broadcastChannel: BroadcastChannel | null = null
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        broadcastChannel = new BroadcastChannel(AUTH_IDENTITY_BROADCAST_CHANNEL)
        broadcastChannel.onmessage = () => { void checkIdentity() }
      } catch {
        broadcastChannel = null
      }
    }

    window.addEventListener('focus', onVisibilityOrFocus)
    document.addEventListener('visibilitychange', onVisibilityOrFocus)
    window.addEventListener('storage', onStorage)

    return () => {
      cancelled = true
      window.removeEventListener('focus', onVisibilityOrFocus)
      document.removeEventListener('visibilitychange', onVisibilityOrFocus)
      window.removeEventListener('storage', onStorage)
      if (broadcastChannel) {
        broadcastChannel.onmessage = null
        broadcastChannel.close()
      }
    }
  }, [serverUserId])

  return null
}

export function notifyAuthIdentityChange(): void {
  if (typeof window === 'undefined') return
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(AUTH_IDENTITY_BROADCAST_CHANNEL)
      channel.postMessage('changed')
      channel.close()
    }
  } catch {
    // ignore — fall back to storage event below
  }
  try {
    window.localStorage.setItem(AUTH_IDENTITY_STORAGE_KEY, String(Date.now()))
  } catch {
    // private mode / quota errors are non-fatal
  }
}
