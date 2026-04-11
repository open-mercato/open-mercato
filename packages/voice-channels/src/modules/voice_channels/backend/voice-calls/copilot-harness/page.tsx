'use client'

import { useCallback, useEffect, useRef } from 'react'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { APP_EVENT_DOM_NAME } from '@open-mercato/ui/backend/injection/useAppEvent'
import { Button } from '@open-mercato/ui/primitives/button'
import type { MockCallScript, TranscriptSegment } from '../../../types'
import { DEMO_1_ACME_STEEL } from '../../../data/demo-scripts/demo-1-acme-steel'
import { DEMO_SUGGESTIONS } from '../../../data/demo-scripts/demo-suggestions'
import { CopilotWorkspace } from '../../../components/copilot/CopilotWorkspace'

const demoScript: MockCallScript = DEMO_1_ACME_STEEL

function dispatchAppEvent(id: string, payload: Record<string, unknown>) {
  window.dispatchEvent(
    new CustomEvent(APP_EVENT_DOM_NAME, {
      detail: { id, payload, tenantId: null, organizationId: null, createdAt: Date.now() },
    }),
  )
}

export default function CopilotHarnessPage() {
  const timersRef = useRef<number[]>([])

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer))
    timersRef.current = []
  }, [])

  useEffect(() => () => clearTimers(), [clearTimers])

  const runReplay = useCallback(() => {
    clearTimers()
    const startedAt = Date.now()

    dispatchAppEvent('voice_channels.call.started', {
      callId: demoScript.callId,
      providerKey: 'mock',
      providerCallId: demoScript.callId,
      phoneNumber: demoScript.phoneNumber,
      direction: demoScript.direction,
      customerId: demoScript.customerId,
      customerName: demoScript.customerName,
      companyName: demoScript.companyName,
      startedAt,
    })

    let cumulativeDelay = 0
    let segmentCount = 0
    let suggestionCount = 0

    for (const segment of demoScript.segments) {
      cumulativeDelay += segment.delayMs
      const segmentOffsetMs = cumulativeDelay
      const transcriptSegment: TranscriptSegment = {
        segmentId: segment.segmentId,
        speaker: segment.speaker,
        text: segment.text,
        confidence: 0.95,
        isFinal: true,
        startTime: segmentOffsetMs / 1000,
        endTime: segmentOffsetMs / 1000 + 2,
        language: demoScript.language,
      }

      timersRef.current.push(
        window.setTimeout(() => {
          dispatchAppEvent('voice_channels.call.transcript_segment', {
            callId: demoScript.callId,
            segment: transcriptSegment,
          })
          segmentCount += 1
        }, segmentOffsetMs),
      )

      const suggestion = DEMO_SUGGESTIONS[segment.segmentId]
      if (suggestion) {
        timersRef.current.push(
          window.setTimeout(() => {
            dispatchAppEvent('voice_channels.copilot.suggestion', {
              callId: demoScript.callId,
              suggestion: {
                ...suggestion,
                id: `${suggestion.type}-${segment.segmentId}-${Date.now()}`,
                triggerSegmentId: segment.segmentId,
                triggerText: segment.text,
                createdAt: Date.now(),
              },
            })
            suggestionCount += 1
          }, segmentOffsetMs + 400),
        )
      }
    }

    timersRef.current.push(
      window.setTimeout(() => {
        dispatchAppEvent('voice_channels.call.ended', {
          callId: demoScript.callId,
          providerKey: 'mock',
          providerCallId: demoScript.callId,
          durationSeconds: Math.round(cumulativeDelay / 1000),
          segmentCount,
          suggestionCount,
        })
      }, cumulativeDelay + 1500),
    )

    flash('Demo replay started for Copilot QA harness.', 'info')
  }, [clearTimers])

  const stopReplay = useCallback(() => {
    clearTimers()
    dispatchAppEvent('voice_channels.call.ended', {
      callId: demoScript.callId,
      providerKey: 'mock',
      providerCallId: demoScript.callId,
      durationSeconds: 0,
      segmentCount: 0,
      suggestionCount: 0,
    })
    flash('Demo replay stopped.', 'info')
  }, [clearTimers])

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/30 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={runReplay}>
            Start Replay
          </Button>
          <Button type="button" variant="outline" onClick={stopReplay}>
            Stop Replay
          </Button>
          <span className="text-sm text-muted-foreground">
            QA harness only. Main Copilot UI remains event-driven and provider-agnostic.
          </span>
        </div>
      </div>

      <CopilotWorkspace />
    </div>
  )
}
