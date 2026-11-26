"use client"
import { useEffect, useRef } from 'react'
import { apiCall } from '../utils/apiCall'
import { getRequiredNotificationHandlerFeatures } from './NotificationDispatcher'

export function useNotificationHandlerFeatures() {
  const grantedFeaturesRef = useRef<string[]>([])

  useEffect(() => {
    const features = getRequiredNotificationHandlerFeatures()
    grantedFeaturesRef.current = []
    if (features.length === 0) return

    let request: AbortController | undefined
    const loadFeatures = async () => {
      request?.abort()
      const controller = new AbortController()
      request = controller
      try {
        const response = await apiCall<{ granted?: string[] }>('/api/auth/feature-check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ features }),
          signal: controller.signal,
        })
        if (controller.signal.aborted || !response.ok) return
        grantedFeaturesRef.current = response.result?.granted ?? []
        window.removeEventListener('online', retry)
      } catch {
        if (!controller.signal.aborted) grantedFeaturesRef.current = []
      }
    }
    const retry = () => { void loadFeatures() }

    window.addEventListener('online', retry)
    retry()
    return () => {
      window.removeEventListener('online', retry)
      request?.abort()
    }
  }, [])

  return grantedFeaturesRef
}
