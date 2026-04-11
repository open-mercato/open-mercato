'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import type {
  CallEndEventPayload,
  CallStartEventPayload,
  SuggestionCard,
  TranscriptSegment,
} from '../../types'
import { CallHeader } from './CallHeader'
import { CopilotToggle } from './CopilotToggle'
import { SuggestionStack } from './SuggestionStack'
import { TranscriptFeed } from './TranscriptFeed'

const COPILOT_KEYFRAMES = `
@keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
@keyframes slideIn { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
@keyframes highlightPulse { 0%, 100% { box-shadow: 0 0 0 rgba(234, 179, 8, 0); } 50% { box-shadow: 0 0 16px rgba(234, 179, 8, 0.4); } }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
`

export function CopilotWorkspace() {
  useEffect(() => {
    const style = document.createElement('style')
    style.textContent = COPILOT_KEYFRAMES
    document.head.appendChild(style)
    return () => {
      document.head.removeChild(style)
    }
  }, [])

  const [segments, setSegments] = useState<TranscriptSegment[]>([])
  const [suggestions, setSuggestions] = useState<SuggestionCard[]>([])
  const [callActive, setCallActive] = useState(false)
  const [callInfo, setCallInfo] = useState<CallStartEventPayload | null>(null)
  const [copilotEnabled, setCopilotEnabled] = useState(true)
  const [callDuration, setCallDuration] = useState(0)
  const [activeCallId, setActiveCallId] = useState<string | null>(null)
  const [highlightedSegmentId, setHighlightedSegmentId] = useState<number | null>(null)
  const [intentToast, setIntentToast] = useState<string | null>(null)

  useAppEvent('voice_channels.call.started', (event) => {
    const payload = event.payload as unknown as CallStartEventPayload
    setCallActive(true)
    setCallInfo(payload)
    setActiveCallId(payload.callId)
    setSegments([])
    setSuggestions([])
    setCallDuration(0)
    setHighlightedSegmentId(null)
    setIntentToast(null)
  })

  useAppEvent(
    'voice_channels.call.ended',
    (event) => {
      const payload = event.payload as unknown as CallEndEventPayload
      if (activeCallId && payload.callId !== activeCallId) return
      setCallActive(false)
      setCallDuration(payload.durationSeconds)
    },
    [activeCallId],
  )

  useAppEvent(
    'voice_channels.call.transcript_segment',
    (event) => {
      const payload = event.payload as unknown as { callId: string; segment: TranscriptSegment }
      if (activeCallId && payload.callId !== activeCallId) return
      setSegments((prev) => [...prev, payload.segment])
    },
    [activeCallId],
  )

  useAppEvent(
    'voice_channels.copilot.suggestion',
    (event) => {
      if (!copilotEnabled) return
      const payload = event.payload as unknown as { callId: string; suggestion: SuggestionCard }
      if (activeCallId && payload.callId !== activeCallId) return
      const card = payload.suggestion

      if (card.detectedIntent) {
        setIntentToast(card.detectedIntent)
        window.setTimeout(() => setIntentToast(null), 1200)
      }

      if (card.triggerSegmentId > 0) {
        setHighlightedSegmentId(card.triggerSegmentId)
        window.setTimeout(() => setHighlightedSegmentId(null), 4000)
      }

      setSuggestions((prev) => {
        const filtered = prev.filter(
          (suggestion) =>
            suggestion.type !== card.type || Date.now() - suggestion.createdAt < 60_000,
        )
        const priorityOrder: Record<SuggestionCard['priority'], number> = {
          high: 0,
          medium: 1,
          low: 2,
        }
        return [...filtered, card]
          .sort((a, b) => {
            const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority]
            if (priorityDiff !== 0) return priorityDiff
            return b.createdAt - a.createdAt
          })
          .slice(0, 5)
      })
    },
    [activeCallId, copilotEnabled],
  )

  const handleDismiss = useCallback((suggestionId: string) => {
    setSuggestions((prev) => prev.filter((suggestion) => suggestion.id !== suggestionId))
  }, [])

  const footerLabel = callInfo
    ? `Sesja: ${callInfo.callId}${callInfo.providerKey ? ` · Provider: ${callInfo.providerKey}` : ''}${callInfo.providerCallId ? ` · Provider call: ${callInfo.providerCallId}` : ''}`
    : 'Oczekiwanie na aktywną sesję połączenia'

  return (
    <div
      className="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card text-foreground shadow-sm"
      style={{ height: 'calc(100dvh - 11rem)' }}
    >
      <CallHeader callActive={callActive} callInfo={callInfo} callDuration={callDuration} />

      <div className="flex min-h-0 flex-1 gap-px overflow-hidden border-y bg-border">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-card">
          <div className="border-b px-5 py-4 text-sm font-semibold text-muted-foreground">
            Transkrypcja na żywo
          </div>
          <TranscriptFeed segments={segments} highlightedSegmentId={highlightedSegmentId} />
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-muted/30">
          <div className="flex items-center justify-between border-b px-5 py-4 text-sm font-semibold text-muted-foreground">
            <span>🤖 Call Copilot</span>
            <CopilotToggle enabled={copilotEnabled} onChange={setCopilotEnabled} />
          </div>
          {intentToast ? (
            <div
              className="flex items-center gap-2 border-b border-amber-300 bg-amber-100 px-4 py-2 text-[13px] font-semibold text-amber-900"
              style={{ animation: 'fadeIn 0.2s ease-in' }}
            >
              <span
                className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500"
                style={{ animation: 'pulse 1s infinite' }}
              />
              Wykryto intencję: {intentToast}
            </div>
          ) : null}
          <SuggestionStack suggestions={suggestions} onDismiss={handleDismiss} />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t bg-card px-5 py-3">
        <span className="text-xs text-muted-foreground">
          {segments.length} segmentów · {suggestions.length} sugestii
        </span>
        <span className="text-xs text-muted-foreground">{footerLabel}</span>
      </div>
    </div>
  )
}
