"use client"

import * as React from 'react'
import { apiCall } from '../utils/apiCall'

export type MessagePollItem = {
  id: string
  type: string
  subject: string
  bodyPreview: string
  senderUserId: string
  senderName?: string | null
  senderEmail?: string | null
  priority: string
  status: string
  hasObjects: boolean
  objectCount: number
  hasAttachments: boolean
  attachmentCount: number
  hasActions: boolean
  actionTaken?: string | null
  sentAt?: string | null
  readAt?: string | null
  threadId?: string | null
}

export type UseMessagesPollResult = {
  messages: MessagePollItem[]
  unreadCount: number
  hasNew: boolean
  isLoading: boolean
  error: string | null
  refresh: () => Promise<void>
}

const POLL_INTERVAL = 5000

export type UseMessagesPollOptions = {
  enabled?: boolean
}

export function useMessagesPoll(options?: UseMessagesPollOptions): UseMessagesPollResult {
  const enabled = options?.enabled ?? true
  const [messages, setMessages] = React.useState<MessagePollItem[]>([])
  const [unreadCount, setUnreadCount] = React.useState(0)
  const [hasNew, setHasNew] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(enabled)
  const [error, setError] = React.useState<string | null>(null)

  const lastMessageIdRef = React.useRef<string | null>(null)
  const pulseTimeoutRef = React.useRef<number | null>(null)

  const fetchMessages = React.useCallback(async () => {
    if (!enabled) return
    try {
      const [listResult, countResult] = await Promise.all([
        apiCall<{ items?: MessagePollItem[] }>('/api/messages?folder=inbox&page=1&pageSize=20'),
        apiCall<{ unreadCount?: number }>('/api/messages/unread-count'),
      ])

      const accessDenied = listResult.status === 403 || countResult.status === 403
      if (accessDenied) {
        setMessages([])
        setUnreadCount(0)
        setHasNew(false)
        setError(null)
        return
      }

      if (listResult.ok) {
        const nextMessages = Array.isArray(listResult.result?.items) ? listResult.result?.items ?? [] : []
        const firstId = nextMessages[0]?.id ?? null

        if (lastMessageIdRef.current && firstId && firstId !== lastMessageIdRef.current) {
          setHasNew(true)
          if (pulseTimeoutRef.current) {
            window.clearTimeout(pulseTimeoutRef.current)
          }
          pulseTimeoutRef.current = window.setTimeout(() => {
            setHasNew(false)
            pulseTimeoutRef.current = null
          }, 3000)
        }

        lastMessageIdRef.current = firstId
        setMessages(nextMessages)
      }

      if (countResult.ok) {
        const nextCount = Number(countResult.result?.unreadCount ?? 0)
        setUnreadCount(Number.isFinite(nextCount) ? Math.max(0, nextCount) : 0)
      }

      setError(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to poll messages'
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }, [enabled])

  React.useEffect(() => {
    if (!enabled) {
      setMessages([])
      setUnreadCount(0)
      setHasNew(false)
      setError(null)
      setIsLoading(false)
      lastMessageIdRef.current = null
      return
    }

    setIsLoading(true)
    void fetchMessages()
    const interval = window.setInterval(() => {
      void fetchMessages()
    }, POLL_INTERVAL)

    return () => {
      window.clearInterval(interval)
      if (pulseTimeoutRef.current) {
        window.clearTimeout(pulseTimeoutRef.current)
      }
    }
  }, [enabled, fetchMessages])

  return {
    messages,
    unreadCount,
    hasNew,
    isLoading,
    error,
    refresh: enabled ? fetchMessages : async () => {},
  }
}
