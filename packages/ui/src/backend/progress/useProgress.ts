"use client"
import { useProgressPoll, type UseProgressPollResult } from './useProgressPoll'
import { useProgressSse } from './useProgressSse'

const progressStrategy =
  typeof window !== 'undefined' && typeof window.EventSource !== 'undefined'
    ? useProgressSse
    : useProgressPoll

export function useProgress(): UseProgressPollResult {
  return progressStrategy()
}
