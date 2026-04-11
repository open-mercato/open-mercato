import { IntentDetector } from '../intent-detector'
import type { TranscriptSegment } from '@open-mercato/voice-channels/modules/voice_channels/types'

function makeSegment(overrides: Partial<TranscriptSegment> = {}): TranscriptSegment {
  return {
    segmentId: 1,
    speaker: 'customer',
    text: '',
    confidence: 0.95,
    isFinal: true,
    startTime: 0,
    endTime: 2,
    language: 'pl',
    ...overrides,
  }
}

describe('IntentDetector', () => {
  const detector = new IntentDetector()

  describe('detectByKeywords', () => {
    it('returns product_need for Polish text "potrzebuję rur"', () => {
      const segment = makeSegment({ text: 'potrzebuję rur PE do instalacji' })
      const result = detector.detectByKeywords(segment)
      expect(result).not.toBeNull()
      expect(result!.intent).toBe('product_need')
      expect(result!.keywords.length).toBeGreaterThan(0)
    })

    it('returns null for rep speaker', () => {
      const segment = makeSegment({ speaker: 'rep', text: 'potrzebuję rur' })
      const result = detector.detectByKeywords(segment)
      expect(result).toBeNull()
    })

    it('returns null for unrecognized text', () => {
      const segment = makeSegment({ text: 'lorem ipsum dolor sit amet' })
      const result = detector.detectByKeywords(segment)
      expect(result).toBeNull()
    })
  })
})
