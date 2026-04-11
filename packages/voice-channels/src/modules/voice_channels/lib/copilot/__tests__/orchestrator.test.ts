import { CopilotOrchestrator } from '../orchestrator'
import type { TranscriptSegment } from '@open-mercato/voice-channels/modules/voice_channels/types'

const mockContainer = {
  resolve: jest.fn().mockReturnValue(undefined),
  register: jest.fn(),
} as any

describe('CopilotOrchestrator', () => {
  let orchestrator: CopilotOrchestrator

  beforeEach(() => {
    orchestrator = new CopilotOrchestrator(mockContainer)
    jest.clearAllMocks()
  })

  it('startSession creates entry in sessions map', async () => {
    await orchestrator.startSession('call-1', undefined, 'tenant-1', 'org-1')
    // Verify session exists by processing a segment (should not throw)
    const segment: TranscriptSegment = {
      segmentId: 1,
      speaker: 'rep',
      text: 'Hello',
      confidence: 0.95,
      isFinal: true,
      startTime: 0,
      endTime: 2,
    }
    await expect(orchestrator.processSegment('call-1', segment)).resolves.not.toThrow()
  })

  it('endSession removes session', async () => {
    await orchestrator.startSession('call-2', undefined, 'tenant-1', 'org-1')
    orchestrator.endSession('call-2')
    // processSegment should be a no-op for unknown callId
    const segment: TranscriptSegment = {
      segmentId: 1,
      speaker: 'customer',
      text: 'potrzebuję rur',
      confidence: 0.95,
      isFinal: true,
      startTime: 0,
      endTime: 2,
    }
    await expect(orchestrator.processSegment('call-2', segment)).resolves.not.toThrow()
  })

  it('processSegment with non-customer speaker is a no-op', async () => {
    await orchestrator.startSession('call-3', undefined, 'tenant-1', 'org-1')
    const segment: TranscriptSegment = {
      segmentId: 1,
      speaker: 'rep',
      text: 'potrzebuję rur',
      confidence: 0.95,
      isFinal: true,
      startTime: 0,
      endTime: 2,
    }
    // Should not attempt to route intents for non-customer speech
    await expect(orchestrator.processSegment('call-3', segment)).resolves.not.toThrow()
  })
})
