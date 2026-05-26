"use client"

import { useMessagesPoll, type UseMessagesPollResult } from './useMessagesPoll'
import { useMessagesSse } from './useMessagesSse'

const messagesStrategy =
  typeof window !== 'undefined' && typeof window.EventSource !== 'undefined'
    ? useMessagesSse
    : useMessagesPoll

export function useMessages(): UseMessagesPollResult {
  return messagesStrategy()
}
