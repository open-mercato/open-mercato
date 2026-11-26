"use client"
import { useEffect, useRef, useState } from 'react'
import { apiCall } from '../utils/apiCall'
import { getRequiredNotificationHandlerFeatures } from './NotificationDispatcher'

const RETRY_DELAYS_MS = [1000, 2000, 4000]

export function useNotificationHandlerFeatures() {
  const grantedFeaturesRef = useRef<string[] | undefined>(undefined)
  const [grantedFeatures, setGrantedFeatures] = useState<string[]>()

  useEffect(() => {
    const features = getRequiredNotificationHandlerFeatures()
    if (features.length === 0) {
      grantedFeaturesRef.current = []
      return
    }

    let request: AbortController | undefined
    let retryTimer: number | undefined
    let retryIndex: number | undefined
    let disposed = false

    const stopListening = () => {
      window.removeEventListener('online', retry)
      window.removeEventListener('focus', retry)
      if (retryTimer !== undefined) window.clearTimeout(retryTimer)
    }

    const loadFeatures = async () => {
      const controller = new AbortController()
      request = controller
      try {
        // eslint-disable-next-line om-ds/require-loading-state -- Handler grants load in the background without blocking the notification UI.
        const response = await apiCall<{ granted?: string[] }>('/api/auth/feature-check', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-om-forbidden-redirect': '0',
            'x-om-unauthorized-redirect': '0',
          },
          body: JSON.stringify({ features }),
          signal: controller.signal,
        })
        if (disposed) return
        if (response.ok) {
          const granted = response.result?.granted ?? []
          grantedFeaturesRef.current = granted
          setGrantedFeatures(granted)
          stopListening()
          return
        }
      } catch {
        // Unavailable feature checks leave handlers gated until a successful response.
      } finally {
        request = undefined
      }

      if (disposed || !navigator.onLine || retryIndex === undefined) return
      const delay = RETRY_DELAYS_MS[retryIndex]
      if (delay === undefined) return
      retryIndex += 1
      retryTimer = window.setTimeout(() => {
        retryTimer = undefined
        if (navigator.onLine) void loadFeatures()
      }, delay)
    }

    const retry = () => {
      if (retryTimer !== undefined || !navigator.onLine) return
      if (request) {
        retryIndex ??= 0
        return
      }
      retryIndex = 0
      void loadFeatures()
    }

    window.addEventListener('online', retry)
    window.addEventListener('focus', retry)
    void loadFeatures()

    return () => {
      disposed = true
      stopListening()
      request?.abort()
    }
  }, [])

  return { grantedFeaturesRef, grantedFeatures }
}
