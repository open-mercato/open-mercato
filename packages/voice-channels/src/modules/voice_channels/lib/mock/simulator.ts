import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type {
  MockCallScript,
  MockScriptSegment,
  TranscriptSegment,
  CallStartEventPayload,
  CallEndEventPayload,
  TranscriptSegmentEventPayload,
} from '@open-mercato/voice-channels/modules/voice_channels/types'

interface ActiveMockCall {
  script: MockCallScript
  currentSegmentIndex: number
  timer: ReturnType<typeof setTimeout> | null
  startedAt: number
  status: 'playing' | 'paused' | 'completed'
}

export class MockTranscriptSimulator {
  private container: AppContainer
  private activeCall: ActiveMockCall | null = null

  constructor(container: AppContainer) {
    this.container = container
  }

  async startCall(
    script: MockCallScript,
    tenantId: string,
    organizationId: string
  ): Promise<{ callId: string }> {
    if (this.activeCall) {
      this.stopCall()
    }

    this.activeCall = {
      script,
      currentSegmentIndex: 0,
      timer: null,
      startedAt: Date.now(),
      status: 'playing',
    }

    // Emit call.started event
    await this.emitEvent('voice_channels.call.started', {
      callId: script.callId,
      phoneNumber: script.phoneNumber,
      direction: script.direction,
      customerId: script.customerId,
      customerName: script.customerName,
      companyName: script.companyName,
      startedAt: Date.now(),
    } satisfies CallStartEventPayload, tenantId, organizationId)

    // Schedule the first segment
    this.scheduleNextSegment(tenantId, organizationId)

    return { callId: script.callId }
  }

  stopCall(): void {
    if (this.activeCall?.timer) {
      clearTimeout(this.activeCall.timer)
    }
    this.activeCall = null
  }

  getStatus(): { status: string; segmentIndex: number; totalSegments: number } | null {
    if (!this.activeCall) return null
    return {
      status: this.activeCall.status,
      segmentIndex: this.activeCall.currentSegmentIndex,
      totalSegments: this.activeCall.script.segments.length,
    }
  }

  isRunning(): boolean {
    return this.activeCall !== null && this.activeCall.status === 'playing'
  }

  currentCallId(): string | null {
    return this.activeCall?.script.callId ?? null
  }

  elapsedMs(): number | null {
    if (!this.activeCall) return null
    return Date.now() - this.activeCall.startedAt
  }

  private scheduleNextSegment(tenantId: string, organizationId: string): void {
    if (!this.activeCall || this.activeCall.status !== 'playing') return

    const { script, currentSegmentIndex } = this.activeCall
    if (currentSegmentIndex >= script.segments.length) {
      this.completeCall(tenantId, organizationId)
      return
    }

    const segment = script.segments[currentSegmentIndex]

    this.activeCall.timer = setTimeout(async () => {
      if (!this.activeCall) return

      const transcriptSegment: TranscriptSegment = {
        segmentId: segment.segmentId,
        speaker: segment.speaker,
        text: segment.text,
        confidence: 0.95,
        isFinal: true,
        startTime: (Date.now() - this.activeCall.startedAt) / 1000,
        endTime: (Date.now() - this.activeCall.startedAt) / 1000 + 2,
        language: script.language,
      }

      // Emit transcript segment event
      await this.emitEvent('voice_channels.call.transcript_segment', {
        callId: script.callId,
        segment: transcriptSegment,
      } satisfies TranscriptSegmentEventPayload, tenantId, organizationId)

      // Advance to next segment
      this.activeCall!.currentSegmentIndex++
      this.scheduleNextSegment(tenantId, organizationId)
    }, segment.delayMs)
  }

  private async completeCall(tenantId: string, organizationId: string): Promise<void> {
    if (!this.activeCall) return

    const { script, startedAt } = this.activeCall
    this.activeCall.status = 'completed'

    await this.emitEvent('voice_channels.call.ended', {
      callId: script.callId,
      durationSeconds: Math.round((Date.now() - startedAt) / 1000),
      segmentCount: script.segments.length,
      suggestionCount: 0, // Will be tracked by orchestrator in integration
    } satisfies CallEndEventPayload, tenantId, organizationId)
  }

  private async emitEvent(
    eventId: string,
    payload: Record<string, unknown>,
    tenantId: string,
    organizationId: string
  ): Promise<void> {
    // Use the module's typed event emitter (imported at top of file)
    const { emitVoiceEvent } = require('../../events')
    await emitVoiceEvent(eventId as any, {
      ...payload,
      tenantId,
      organizationId,
    }, { persistent: false })
  }
}
