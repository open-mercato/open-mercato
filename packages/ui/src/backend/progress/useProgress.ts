"use client"
import { useProgressPoll, type UseProgressPollResult } from './useProgressPoll'
import { useProgressSse } from './useProgressSse'

export function useProgress(): UseProgressPollResult {
  const strategy =
    typeof window !== 'undefined' && typeof window.EventSource !== 'undefined'
      ? useProgressSse
      : useProgressPoll

  return strategy()
}
