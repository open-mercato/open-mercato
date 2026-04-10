import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  {
    id: 'voice_channels.call.started',
    label: 'Voice Call Started',
    entity: 'call',
    category: 'lifecycle' as const,
    clientBroadcast: true,
  },
  {
    id: 'voice_channels.call.ended',
    label: 'Voice Call Ended',
    entity: 'call',
    category: 'lifecycle' as const,
    clientBroadcast: true,
  },
  {
    id: 'voice_channels.call.transcript_segment',
    label: 'Transcript Segment Received',
    entity: 'call',
    category: 'lifecycle' as const,
    clientBroadcast: true,
  },
  {
    id: 'voice_channels.copilot.suggestion',
    label: 'Copilot Suggestion Generated',
    entity: 'call',
    category: 'custom' as const,
    clientBroadcast: true,
  },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'voice_channels',
  events,
})

export const emitVoiceEvent = eventsConfig.emit

export type VoiceChannelsEventId = typeof events[number]['id']

export default eventsConfig
