"use client"
import { useNotificationsPoll, type UseNotificationsPollResult } from './useNotificationsPoll'
import { useNotificationsSse } from './useNotificationsSse'

const notificationsStrategy =
  typeof window !== 'undefined' && typeof window.EventSource !== 'undefined'
    ? useNotificationsSse
    : useNotificationsPoll

export function useNotifications(): UseNotificationsPollResult {
  return notificationsStrategy()
}
