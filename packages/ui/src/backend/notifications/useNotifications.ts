"use client"
import { useNotificationsPoll, type UseNotificationsPollResult } from './useNotificationsPoll'
import { useNotificationsSse } from './useNotificationsSse'

export function useNotifications(): UseNotificationsPollResult {
  const strategy =
    typeof window !== 'undefined' && typeof window.EventSource !== 'undefined'
      ? useNotificationsSse
      : useNotificationsPoll

  return strategy()
}
