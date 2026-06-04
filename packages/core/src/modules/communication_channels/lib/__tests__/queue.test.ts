import {
  COMMUNICATION_CHANNELS_QUEUES,
  getCommunicationChannelsQueue,
} from '../queue'

describe('communication_channels queue helper', () => {
  it('exposes canonical queue names', () => {
    expect(COMMUNICATION_CHANNELS_QUEUES.inbound).toBe('communication-channels-inbound')
    expect(COMMUNICATION_CHANNELS_QUEUES.outbound).toBe('communication-channels-outbound')
    expect(COMMUNICATION_CHANNELS_QUEUES.reactions).toBe('communication-channels-reactions')
  })

  it('returns the same Queue instance for the same name (memoization)', () => {
    const a = getCommunicationChannelsQueue(COMMUNICATION_CHANNELS_QUEUES.inbound)
    const b = getCommunicationChannelsQueue(COMMUNICATION_CHANNELS_QUEUES.inbound)
    expect(a).toBe(b)
  })

  it('returns different instances for different queue names', () => {
    const a = getCommunicationChannelsQueue(COMMUNICATION_CHANNELS_QUEUES.inbound)
    const b = getCommunicationChannelsQueue(COMMUNICATION_CHANNELS_QUEUES.outbound)
    expect(a).not.toBe(b)
  })
})
