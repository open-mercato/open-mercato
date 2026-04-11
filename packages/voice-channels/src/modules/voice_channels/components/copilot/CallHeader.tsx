'use client'

import { useState, useEffect } from 'react'
import type { CallStartEventPayload } from '../../types'

interface CallHeaderProps {
  callActive: boolean
  callInfo: CallStartEventPayload | null
  callDuration: number
}

export function CallHeader({ callActive, callInfo, callDuration }: CallHeaderProps) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!callActive || !callInfo) {
      setElapsed(0)
      return
    }
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - callInfo.startedAt) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [callActive, callInfo])

  const displayTime = callActive ? elapsed : callDuration
  const minutes = Math.floor(displayTime / 60)
  const seconds = displayTime % 60
  const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`

  return (
    <div className="flex items-center justify-between bg-card px-6 py-4">
      <div className="flex items-center gap-4">
        {callActive && (
          <span
            className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500"
            style={{ animation: 'pulse 2s infinite' }}
          />
        )}
        <div>
          <div className="text-lg font-bold text-foreground">
            {callInfo
              ? `${callInfo.customerName ?? 'Klient'} — ${callInfo.companyName ?? ''}`
              : 'Brak aktywnego połączenia'}
          </div>
          <div className="text-sm text-muted-foreground">
            {callInfo ? callInfo.phoneNumber : '—'}
            {callInfo &&
              ` · ${callInfo.direction === 'outbound' ? 'Połączenie wychodzące' : 'Połączenie przychodzące'}`}
            {callInfo?.providerKey ? ` · ${callInfo.providerKey}` : ''}
            {callInfo?.providerCallId ? ` · ${callInfo.providerCallId}` : ''}
          </div>
        </div>
      </div>
      <div className="text-2xl font-bold tabular-nums tracking-wider text-foreground">{timeStr}</div>
    </div>
  )
}
