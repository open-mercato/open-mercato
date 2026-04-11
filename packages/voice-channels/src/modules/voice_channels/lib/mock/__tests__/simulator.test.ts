import { MockTranscriptSimulator } from '../simulator'

jest.mock('../../../events', () => ({
  emitVoiceEvent: jest.fn().mockResolvedValue(undefined),
}))

const mockContainer = {
  resolve: jest.fn().mockReturnValue(undefined),
  register: jest.fn(),
} as any

describe('MockTranscriptSimulator', () => {
  let simulator: MockTranscriptSimulator

  beforeEach(() => {
    simulator = new MockTranscriptSimulator(mockContainer)
    jest.clearAllMocks()
  })

  afterEach(() => {
    simulator.stopCall()
  })

  it('getStatus returns null when no active call', () => {
    expect(simulator.getStatus()).toBeNull()
  })

  it('startCall creates active call state', async () => {
    const script = {
      callId: 'test-call-1',
      phoneNumber: '+48123456789',
      direction: 'inbound' as const,
      customerId: 'cust-1',
      customerName: 'Jan Kowalski',
      companyName: 'Test Sp. z o.o.',
      language: 'pl',
      segments: [
        { segmentId: 1, speaker: 'customer' as const, text: 'Dzień dobry', delayMs: 5000 },
      ],
    }

    await simulator.startCall(script, 'tenant-1', 'org-1')

    const status = simulator.getStatus()
    expect(status).not.toBeNull()
    expect(status!.status).toBe('playing')
    expect(status!.segmentIndex).toBe(0)
    expect(status!.totalSegments).toBe(1)
  })
})
