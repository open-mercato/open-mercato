import type { EventPayload } from '@open-mercato/shared/modules/events'
import type { TranscriptSegmentEventPayload } from '@open-mercato/voice-channels/modules/voice_channels/types'

export const metadata = {
  event: 'voice_channels.call.transcript_segment',
  id: 'voice_channels.copilot.segment-handler',
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

export default async function handler(
  payload: EventPayload & TranscriptSegmentEventPayload,
  ctx: ResolverContext
) {
  const orchestrator = ctx.resolve<any>('copilotOrchestrator')

  // processSegment uses callId to look up the correct session
  await orchestrator.processSegment(payload.callId, payload.segment)
}
